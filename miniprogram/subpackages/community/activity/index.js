'use strict';

const communityService = require('../../../services/community');
const userService = require('../../../services/user');
const { calculateContentTopInset } = require('../../../utils/navigation-layout');
const { normalizeAvatarSlots, fallbackAvatarSlot } = require('../../../utils/passenger-avatar');

const PAGE_SIZE = 20;
const TABS = Object.freeze([
  { value: 'ALL', label: '全部' },
  { value: 'REPLIES', label: '回复我的' },
  { value: 'LIKES', label: '收到的赞' }
]);
const AVATAR_TONES = ['blue', 'purple', 'orange', 'green', 'teal'];

function normalizeUnreadSummary(value) {
  const tabs = value && value.tabs || {};
  const readCount = (key) => {
    const count = Number(key === 'ALL' ? value && value.total : tabs[key]);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid community unread summary');
    return count;
  };
  const all = readCount('ALL');
  return { ALL: all, REPLIES: readCount('REPLIES'), LIKES: readCount('LIKES') };
}

function buildTabs(summary = { ALL: 0, REPLIES: 0, LIKES: 0 }) {
  return TABS.map((tab) => {
    const unread = Math.max(0, Number(summary[tab.value]) || 0);
    return { ...tab, unread, unreadLabel: unread > 99 ? '99+' : String(unread || ''), accessibilityLabel: `${tab.label}，${unread ? `${unread}条未读` : '无未读'}` };
  });
}

function formatActivityTime(value, now = Date.now()) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}小时前`;
  if (minutes < 2 * 1440) return '昨天';
  if (minutes < 7 * 1440) return `${Math.floor(minutes / 1440)}天前`;
  const beijingDate = new Date(timestamp + 8 * 60 * 60 * 1000);
  return `${beijingDate.getUTCMonth() + 1}月${beijingDate.getUTCDate()}日`;
}

function decorateActivity(item) {
  const actors = Array.isArray(item && item.actors) ? item.actors : [];
  const firstActor = actors[0] || {};
  const actorName = String(firstActor.nickname || '社区小助手').trim() || '社区小助手';
  const avatarInitial = Array.from(actorName)[0] || '拼';
  const isReply = item && item.type === 'POST_REPLIED';
  const isPostLike = item && item.type === 'POST_LIKED';
  const isReplyLike = item && item.type === 'REPLY_LIKED';
  const isLike = isPostLike || isReplyLike;
  const actorCount = Math.max(isLike ? 1 : 0, Number(item && item.actorCount) || 0);
  const removed = Boolean(item && item.removed);
  const postPreview = removed ? '该讨论已被删除或下架' : String(item && item.postPreview || '');
  const contentPreview = removed ? '' : String(item && item.contentPreview || '');
  let actionText = '发布了社区动态';
  if (isReply) actionText = '回复了你的讨论';
  if (isPostLike) actionText = '赞了你的讨论';
  if (isReplyLike) actionText = '赞了你的评论';
  const countText = isLike && actorCount > 1 ? ` 等 ${actorCount} 人` : '';
  const panelLabel = isReplyLike ? '原讨论：' : '我的讨论：';
  const removedText = isReplyLike ? '该评论或原讨论已被删除或下架' : '该讨论已被删除或下架';
  return {
    ...item,
    actors,
    firstActor,
    actorName,
    actorCount,
    countText,
    actionText,
    isReply,
    isPostLike,
    isReplyLike,
    isLike,
    isSystem: !isReply && !isLike,
    removed,
    postPreview,
    contentPreview,
    panelLabel,
    removedText,
    displayTime: formatActivityTime(item && item.updatedAt),
    avatarSlot: normalizeAvatarSlots([firstActor.avatar], 1)[0],
    avatarInitial,
    avatarTone: AVATAR_TONES[(avatarInitial.codePointAt(0) || 0) % AVATAR_TONES.length],
    accessibilityLabel: removed
      ? `${actorName}${actionText}，${removedText}，${item && item.read ? '已读' : '未读'}`
      : `${actorName}${countText}${actionText}，${isReplyLike ? `我的评论：${contentPreview}，原讨论：` : contentPreview || item && item.message || '我的讨论：'}${postPreview}，${item && item.read ? '已读' : '未读'}，点击查看讨论`
  };
}

function mergeActivities(current, incoming) {
  const map = new Map([...(current || []), ...(incoming || [])].map((item) => [item.id, item]));
  return [...map.values()].sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)) || String(right.id).localeCompare(String(left.id)));
}

Page({
  data: {
    contentTopInset: 88,
    tabs: buildTabs(),
    currentTab: 'ALL',
    items: [],
    nextCursor: '',
    hasMore: false,
    loading: true,
    loadingMore: false,
    error: '',
    loadMoreError: ''
  },

  onLoad() {
    this._disposed = false;
    this._skipNextShow = true;
    this.setData({ contentTopInset: calculateContentTopInset(typeof wx === 'undefined' ? null : wx) });
    return this.loadActivities(false);
  },
  onShow() {
    this._navigationPending = false;
    this.refreshUnreadSummary();
    if (this._skipNextShow) return void (this._skipNextShow = false);
    if (!this._disposed) this.loadActivities(false);
  },
  onUnload() {
    this._disposed = true;
    this._loadSeq = (this._loadSeq || 0) + 1;
    this._unreadSeq = (this._unreadSeq || 0) + 1;
    if (this._readLocks) this._readLocks.clear();
  },
  onReachBottom() { this.loadActivities(true); },

  async refreshUnreadSummary() {
    const seq = this._unreadSeq = (this._unreadSeq || 0) + 1;
    try {
      await userService.login();
      const result = await communityService.getActivityUnread();
      if (this._disposed || seq !== this._unreadSeq) return;
      this.setData({ tabs: buildTabs(normalizeUnreadSummary(result)) });
    } catch (error) {
      // A failed refresh is not evidence that unread activities disappeared.
    }
  },

  async loadActivities(append = false) {
    if (this._disposed || (append && (!this.data.hasMore || this.data.loadingMore))) return;
    const seq = append ? (this._loadSeq || 0) : (this._loadSeq = (this._loadSeq || 0) + 1);
    this.setData(append
      ? { loadingMore: true, loadMoreError: '' }
      : { loading: true, error: '', loadMoreError: '', items: [], nextCursor: '', hasMore: false });
    try {
      await userService.login();
      const result = await communityService.listActivities({
        tab: this.data.currentTab,
        limit: PAGE_SIZE,
        ...(append && this.data.nextCursor ? { cursor: this.data.nextCursor } : {})
      });
      if (this._disposed || seq !== this._loadSeq) return;
      const incoming = (result.items || []).map(decorateActivity);
      this.setData({
        items: append ? mergeActivities(this.data.items, incoming) : incoming,
        nextCursor: result.nextCursor || '',
        hasMore: Boolean(result.nextCursor),
        loading: false,
        loadingMore: false,
        error: '',
        loadMoreError: ''
      });
    } catch (error) {
      if (this._disposed || seq !== this._loadSeq) return;
      if (append) return void this.setData({ loadingMore: false, loadMoreError: '更多动态加载失败，点击重试' });
      this.setData({ loading: false, loadingMore: false, items: [], error: error.message || '讨论动态暂时无法查看' });
    }
  },

  handleTab(event) {
    const tab = String(event.currentTarget.dataset.tab || '');
    if (!TABS.some((item) => item.value === tab) || tab === this.data.currentTab || this.data.loading) return;
    this.setData({ currentTab: tab });
    this.loadActivities(false);
  },
  handleRetry() { this.loadActivities(false); },
  handleRetryMore() { this.loadActivities(true); },

  handleAvatarError(event) {
    const id = String(event.currentTarget.dataset.id || '');
    if (!id) return;
    this.setData({ items: this.data.items.map((item) => {
      if (item.id !== id || item.avatarSlot.empty) return item;
      const avatarSlot = fallbackAvatarSlot(item.avatarSlot);
      return { ...item, avatarSlot: avatarSlot === item.avatarSlot ? { ...avatarSlot, src: '', empty: true } : avatarSlot };
    }) });
  },

  async handleActivity(event) {
    const id = String(event.currentTarget.dataset.id || '');
    const item = this.data.items.find((candidate) => candidate.id === id);
    if (!item || this._disposed) return;
    if (item.removed) {
      wx.showToast({ title: '该内容已被删除或下架', icon: 'none' });
      if (item.read) return;
      this._readLocks = this._readLocks || new Set();
      if (this._readLocks.has(id)) return;
      this._readLocks.add(id);
      try {
        const result = await communityService.readActivity(id, item.updatedAt, item.postId);
        if (this._disposed) return;
        if (result && result.read === true && result.stale !== true) {
          this.setData({ items: this.data.items.map((candidate) => candidate.id === id ? { ...candidate, read: true } : candidate) });
        }
        this.refreshUnreadSummary();
      } catch (error) {
        // The removed activity remains unread when the acknowledgement fails.
      } finally {
        this._readLocks.delete(id);
      }
      return;
    }
    if (item.postId && !this._navigationPending) {
      this._navigationPending = true;
      const replyId = String(item.replyId || '').trim();
      const replyQuery = replyId && replyId.length <= 80 ? `&replyId=${encodeURIComponent(replyId)}` : '';
      const query = `id=${encodeURIComponent(item.postId)}&activityId=${encodeURIComponent(item.id)}&activityUpdatedAt=${encodeURIComponent(item.updatedAt)}${replyQuery}`;
      wx.navigateTo({
        url: `/subpackages/community/detail/index?${query}`,
        fail: () => { this._navigationPending = false; }
      });
    }
  },

  handleEmptyAction() {
    if (this.data.currentTab === 'REPLIES') return wx.navigateTo({ url: '/subpackages/community/compose/index' });
    return wx.switchTab({ url: '/pages/community/index' });
  },
  handleBack() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    if (pages.length > 1) return wx.navigateBack({ delta: 1 });
    return wx.switchTab({ url: '/pages/community/index' });
  }
});

module.exports = { buildTabs, decorateActivity, formatActivityTime, mergeActivities, normalizeUnreadSummary };
