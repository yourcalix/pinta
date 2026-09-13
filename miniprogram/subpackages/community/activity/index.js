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
  const isLike = item && item.type === 'POST_LIKED';
  const actorCount = Math.max(isLike ? 1 : 0, Number(item && item.actorCount) || 0);
  const removed = Boolean(item && item.removed);
  const postPreview = removed ? '该讨论已被删除或下架' : String(item && item.postPreview || '');
  const contentPreview = removed ? '' : String(item && item.contentPreview || '');
  let actionText = '发布了社区动态';
  if (isReply) actionText = '回复了你的讨论';
  if (isLike) actionText = '赞了你的讨论';
  const countText = isLike && actorCount > 1 ? ` 等 ${actorCount} 人` : '';
  return {
    ...item,
    actors,
    firstActor,
    actorName,
    actorCount,
    countText,
    actionText,
    isReply,
    isLike,
    isSystem: !isReply && !isLike,
    removed,
    postPreview,
    contentPreview,
    displayTime: formatActivityTime(item && item.updatedAt),
    avatarSlot: normalizeAvatarSlots([firstActor.avatar], 1)[0],
    avatarInitial,
    avatarTone: AVATAR_TONES[(avatarInitial.codePointAt(0) || 0) % AVATAR_TONES.length],
    accessibilityLabel: removed
      ? `${actorName}${actionText}，原讨论已被删除或下架，${item && item.read ? '已读' : '未读'}`
      : `${actorName}${countText}${actionText}，${contentPreview || item && item.message || ''}，我的讨论：${postPreview}，${item && item.read ? '已读' : '未读'}，点击查看讨论`
  };
}

function mergeActivities(current, incoming) {
  const map = new Map([...(current || []), ...(incoming || [])].map((item) => [item.id, item]));
  return [...map.values()].sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)) || String(right.id).localeCompare(String(left.id)));
}

Page({
  data: {
    contentTopInset: 88,
    tabs: TABS,
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
    if (this._skipNextShow) return void (this._skipNextShow = false);
    if (!this._disposed) this.loadActivities(false);
  },
  onUnload() {
    this._disposed = true;
    this._loadSeq = (this._loadSeq || 0) + 1;
    if (this._readLocks) this._readLocks.clear();
  },
  onReachBottom() { this.loadActivities(true); },

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
    this._readLocks = this._readLocks || new Set();
    if (this._readLocks.has(id)) return;
    this._readLocks.add(id);
    const wasRead = item.read === true;
    if (!wasRead) this.setData({ items: this.data.items.map((candidate) => candidate.id === id ? { ...candidate, read: true } : candidate) });
    try {
      if (!wasRead) await communityService.readActivity(id);
      if (this._disposed) return;
      if (item.removed) return void wx.showToast({ title: '该讨论已被删除或下架', icon: 'none' });
      if (item.postId && !this._navigationPending) {
        this._navigationPending = true;
        return void wx.navigateTo({
          url: `/subpackages/community/detail/index?id=${encodeURIComponent(item.postId)}`,
          fail: () => { this._navigationPending = false; }
        });
      }
    } catch (error) {
      if (!this._disposed && !wasRead) this.setData({ items: this.data.items.map((candidate) => candidate.id === id ? { ...candidate, read: false } : candidate) });
      if (!this._disposed && !error.handled) wx.showToast({ title: error.message || '操作失败，请重试', icon: 'none' });
    } finally {
      this._readLocks.delete(id);
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

module.exports = { decorateActivity, formatActivityTime, mergeActivities };
