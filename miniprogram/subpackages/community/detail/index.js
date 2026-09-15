'use strict';

const communityService = require('../../../services/community');
const userService = require('../../../services/user');
const safetyService = require('../../../services/safety');
const { COMMUNITY_REPORT_REASONS } = require('../../../utils/community-report-reasons');
const { calculateContentTopInset } = require('../../../utils/navigation-layout');
const { normalizeAvatarSlots, fallbackAvatarSlot } = require('../../../utils/passenger-avatar');
const { openCommunityAuthor } = require('../../../utils/open-community-author');

const PAGE_SIZE = 20;
const AVATAR_TONES = ['blue', 'purple', 'orange', 'green', 'teal'];
function splitContentSegments(content) {
  const source = String(content || '');
  const segments = [];
  const matcher = /#[\u4e00-\u9fa5A-Za-z0-9_]+/g;
  let cursor = 0;
  let match = matcher.exec(source);
  while (match) {
    if (match.index > cursor) segments.push({ type: 'text', text: source.slice(cursor, match.index) });
    segments.push({ type: 'tag', text: match[0] });
    cursor = match.index + match[0].length;
    match = matcher.exec(source);
  }
  if (cursor < source.length) segments.push({ type: 'text', text: source.slice(cursor) });
  return segments.length ? segments : [{ type: 'text', text: source }];
}

function formatCommunityTime(value, now = Date.now()) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}小时前`;
  if (minutes < 7 * 1440) return `${Math.floor(minutes / 1440)}天前`;
  const beijingDate = new Date(timestamp + 8 * 60 * 60 * 1000);
  return `${beijingDate.getUTCMonth() + 1}月${beijingDate.getUTCDate()}日`;
}

function decorate(item) {
  const nickname = String(item && item.author && item.author.nickname || '拼吧用户').trim() || '拼吧用户';
  const avatarInitial = Array.from(nickname)[0] || '拼';
  const replyTo = item && item.replyTo && ['ACTIVE', 'UNAVAILABLE'].includes(item.replyTo.status) ? item.replyTo : null;
  const replyToNickname = replyTo && replyTo.status === 'ACTIVE' ? String(replyTo.nickname || '').trim() : '';
  return {
    ...item,
    avatarSlot: normalizeAvatarSlots([item && item.author && item.author.avatar], 1)[0],
    authorNickname: nickname,
    avatarInitial,
    avatarTone: AVATAR_TONES[(avatarInitial.codePointAt(0) || 0) % AVATAR_TONES.length],
    contentSegments: splitContentSegments(item && item.content),
    displayTime: formatCommunityTime(item && item.createdAt),
    likeCount: Math.max(0, Number(item && item.likeCount) || 0),
    viewerHasLiked: Boolean(item && item.viewerHasLiked),
    replyTo,
    replyToNickname,
    replyToDisplayName: replyTo ? (replyTo.status === 'ACTIVE' ? `@${replyToNickname}` : '已删除评论') : '',
    replyToUnavailable: Boolean(replyTo && replyTo.status !== 'ACTIVE'),
    replyContextLabel: replyTo ? `回复${replyToNickname || '已删除评论'}，` : '',
    likePending: false
  };
}

function mergeReplies(current, incoming) {
  const map = new Map([...(current || []), ...(incoming || [])].map((item) => [item.id, item]));
  return [...map.values()].sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)) || String(left.id).localeCompare(String(right.id)));
}

Page({
  data: {
    contentTopInset: 88,
    postId: '', post: null, replies: [], replyContent: '', replyTarget: null,
    replyPlaceholder: '写下你的回复…', replyCursorSpacing: 120, submitting: false,
    loading: true, error: '', nextCursor: '', hasMore: false,
    loadingMore: false, loadMoreError: '', replyInputFocus: false
  },

  onLoad(options) {
    options = options || {};
    this._disposed = false;
    const postId = String(options.id || '').trim();
    const activityId = String(options.activityId || '').trim();
    const activityUpdatedAt = String(options.activityUpdatedAt || '').trim();
    this._sourceActivity = activityId && Number.isFinite(Date.parse(activityUpdatedAt))
      ? { id: activityId, updatedAt: activityUpdatedAt, postId, pending: false, done: false }
      : null;
    this._replyFocus = options.reply === '1' && Boolean(postId);
    const contentTopInset = calculateContentTopInset(typeof wx === 'undefined' ? null : wx);
    this.setData(postId ? { postId, contentTopInset } : { postId: '', contentTopInset, loading: false, error: '讨论参数无效' });
    if (!postId) return;
    return this.loadDetail(false);
  },
  onShow() {
    this._disposed = false;
    this._authorNavPending = false;
    if (this.data.post) this.consumeSourceActivity();
  },
  onHide() { this._disposed = true; },
  onUnload() {
    this._disposed = true;
    this._replyFocus = false;
    this._loadSeq = (this._loadSeq || 0) + 1;
    if (this._actionLocks) this._actionLocks.clear();
  },

  async loadDetail(append = false) {
    if (this._disposed || !this.data.postId || (append && (!this.data.nextCursor || this.data.loadingMore))) return;
    const seq = append ? (this._loadSeq || 0) : (this._loadSeq = (this._loadSeq || 0) + 1);
    this.setData(append ? { loadingMore: true, loadMoreError: '' } : { loading: true, error: '', loadMoreError: '', replies: [], nextCursor: '', hasMore: false });
    try {
      const result = await communityService.getPost(this.data.postId, { limit: PAGE_SIZE, cursor: append ? this.data.nextCursor : undefined });
      if (this._disposed || seq !== this._loadSeq) return;
      const incoming = (result.replies || []).map(decorate);
      const nextData = {
        replies: append ? mergeReplies(this.data.replies, incoming) : incoming,
        nextCursor: result.nextCursor || '', hasMore: Boolean(result.nextCursor),
        loading: false, loadingMore: false, loadMoreError: '', error: ''
      };
      const focus = !append && this._replyFocus;
      if (!append) {
        nextData.post = decorate(result.post);
        nextData.replyInputFocus = false;
        this._replyFocus = false;
      }
      this.setData(nextData);
      if (!append) this.consumeSourceActivity();
      if (focus && await this.ensureInteractionAccess() && !this._disposed && seq === this._loadSeq) {
        this._replyAuthorized = true;
        this.setData({ replyInputFocus: true });
      }
    } catch (error) {
      if (this._disposed || seq !== this._loadSeq) return;
      if (append) return void this.setData({ loadingMore: false, loadMoreError: '更多回复加载失败，请重试' });
      this._replyFocus = false;
      this.setData({ loading: false, loadingMore: false, post: null, replies: [], replyInputFocus: false, error: error.code === 'NOT_FOUND' ? '该讨论已被作者删除或不存在' : '讨论暂时无法查看，请稍后重试' });
    }
  },

  async consumeSourceActivity() {
    const source = this._sourceActivity;
    if (!source || source.done || source.pending || this._disposed || !this.data.post || this.data.post.id !== source.postId) return;
    source.pending = true;
    try {
      const result = await communityService.readActivity(source.id, source.updatedAt, source.postId);
      if (!this._disposed && result && (result.read === true || result.stale === true)) source.done = true;
    } catch (error) {
      // Keep the source activity unread; reopening or showing the detail can retry safely.
    } finally {
      source.pending = false;
    }
  },

  async ensureInteractionAccess() {
    if (this._accessPromise) return this._accessPromise;
    this._accessPromise = userService.login().then((user) => {
      if (this._disposed) return false;
      if (user.profileComplete) return true;
      if (wx.hideKeyboard) wx.hideKeyboard();
      wx.navigateTo({ url: `/subpackages/profile/edit/index?next=${encodeURIComponent(`/subpackages/community/detail/index?id=${this.data.postId}`)}` });
      return false;
    }).catch((error) => {
      if (!this._disposed && !error.handled) wx.showToast({ title: error.message || '暂时无法登录', icon: 'none' });
      return false;
    }).finally(() => { this._accessPromise = null; });
    return this._accessPromise;
  },

  handleReplyInput(event) { this.setData({ replyContent: event.detail.value.slice(0, 300) }); },
  async handleReplyFocus() {
    if (this._replyAuthorized) return void (this._replyAuthorized = false);
    if (!await this.ensureInteractionAccess()) this.setData({ replyInputFocus: false });
  },
  handleReplyBlur() { if (this.data.replyInputFocus) this.setData({ replyInputFocus: false }); },

  async handleSelectReplyTarget(event) {
    const replyId = String(event.currentTarget.dataset.id || '');
    const target = this.data.replies.find((item) => item.id === replyId);
    if (!target || this._disposed || !await this.ensureInteractionAccess() || this._disposed) return;
    this._replyAuthorized = true;
    if (target.viewerIsAuthor) {
      return void this.setData({ replyTarget: null, replyPlaceholder: '写下你的回复…', replyCursorSpacing: 120, replyInputFocus: true });
    }
    this.setData({
      replyTarget: { id: target.id, nickname: target.authorNickname },
      replyPlaceholder: `回复 @${target.authorNickname}…`,
      replyCursorSpacing: 160,
      replyInputFocus: true
    });
  },
  handleCancelReplyTarget() {
    this._replyAuthorized = true;
    this.setData({ replyTarget: null, replyPlaceholder: '写下你的回复…', replyCursorSpacing: 120, replyInputFocus: true });
  },

  handlePostAvatarError() {
    if (this.data.post) this.setData({ post: this.fallbackAuthorAvatar(this.data.post) });
  },
  handleReplyAvatarError(event) {
    const id = String(event.currentTarget.dataset.id || '');
    if (!id) return;
    this.setData({ replies: this.data.replies.map((item) => item.id === id ? this.fallbackAuthorAvatar(item) : item) });
  },
  fallbackAuthorAvatar(item) {
    if (!item || item.avatarSlot.empty) return item;
    const avatarSlot = fallbackAvatarSlot(item.avatarSlot);
    return { ...item, avatarSlot: avatarSlot === item.avatarSlot ? { ...avatarSlot, src: '', empty: true } : avatarSlot };
  },

  async handleSendReply() {
    const content = this.data.replyContent.trim();
    if (!content || this.data.submitting || !await this.ensureInteractionAccess()) return;
    const replyToId = this.data.replyTarget && this.data.replyTarget.id || '';
    this.setData({ submitting: true });
    try {
      const result = await communityService.createReply(this.data.postId, content, replyToId);
      if (this._disposed) return;
      this.setData({
        replyContent: '', replyTarget: null, replyPlaceholder: '写下你的回复…', replyCursorSpacing: 120, replyInputFocus: false,
        replies: mergeReplies(this.data.replies, [decorate(result.reply)]),
        'post.replyCount': Math.max(0, Number(result.replyCount) || 0)
      });
    } catch (error) {
      if (!this._disposed && !error.handled) wx.showToast({ title: error.message || '回复失败，请重试', icon: 'none' });
    } finally {
      if (!this._disposed) this.setData({ submitting: false });
    }
  },

  updateLikeTarget(targetType, targetId, patch) {
    if (this._disposed) return false;
    let prefix = '';
    if (targetType === 'post') {
      if (!this.data.post || this.data.post.id !== targetId) return false;
      prefix = 'post';
    } else {
      const index = this.data.replies.findIndex((item) => item.id === targetId);
      if (index < 0) return false;
      prefix = `replies[${index}]`;
    }
    const payload = {};
    ['viewerHasLiked', 'likeCount', 'likePending'].forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(patch, field)) payload[`${prefix}.${field}`] = patch[field];
    });
    if (!Object.keys(payload).length) return false;
    this.setData(payload);
    return true;
  },

  async handleLike(event) {
    const { targetType, targetId } = event.currentTarget.dataset;
    const key = `${targetType}:${targetId}`;
    if (this._disposed) return;
    if (!this._likeLocks) this._likeLocks = new Set();
    if (this._likeLocks.has(key)) return;
    this._likeLocks.add(key);
    let before = null;
    try {
      if (!await this.ensureInteractionAccess() || this._disposed) return;
      const target = targetType === 'post' ? this.data.post : this.data.replies.find((item) => item.id === targetId);
      if (!target) return;
      before = { viewerHasLiked: Boolean(target.viewerHasLiked), likeCount: Math.max(0, Number(target.likeCount) || 0) };
      const liked = !before.viewerHasLiked;
      this.updateLikeTarget(targetType, targetId, { viewerHasLiked: liked, likeCount: Math.max(0, before.likeCount + (liked ? 1 : -1)), likePending: true });
      const result = await communityService.setLike(targetType, targetId, liked);
      if (this._disposed) return;
      this.updateLikeTarget(targetType, targetId, { viewerHasLiked: result.liked, likeCount: result.likeCount, likePending: false });
    } catch (error) {
      if (this._disposed) return;
      if (before) this.updateLikeTarget(targetType, targetId, { ...before, likePending: false });
      if (!error.handled) wx.showToast({ title: '点赞失败，请重试', icon: 'none' });
    } finally {
      this._likeLocks.delete(key);
    }
  },

  handlePostMore() { return this.showContentActions('communityPost', this.data.post.id, this.data.post.viewerIsAuthor); },
  handleAuthorProfile(event) {
    const sourceType = String(event.currentTarget.dataset.sourceType || 'post');
    const sourceId = String(event.currentTarget.dataset.id || '').trim();
    if (sourceId) return openCommunityAuthor(this, sourceType, sourceId);
  },
  handleReplyMore(event) {
    const item = this.data.replies.find((reply) => reply.id === event.currentTarget.dataset.id);
    if (item) return this.showContentActions('communityReply', item.id, item.viewerIsAuthor);
  },
  showActionSheet(itemList) {
    return new Promise((resolve) => wx.showActionSheet({
      itemList,
      success: (result) => resolve(Number.isInteger(result.tapIndex) ? result.tapIndex : -1),
      fail: () => resolve(-1)
    }));
  },
  confirmDelete() {
    return new Promise((resolve) => wx.showModal({
      title: '确认删除', content: '删除后其他用户将无法再查看，且无法恢复。', confirmText: '删除', confirmColor: '#E5484D',
      success: (result) => resolve(Boolean(result.confirm)), fail: () => resolve(false)
    }));
  },
  async showContentActions(targetType, targetId, isAuthor) {
    const lockKey = `${targetType}:${targetId}`;
    this._actionLocks = this._actionLocks || new Set();
    if (this._disposed || this._actionLocks.has(lockKey)) return;
    this._actionLocks.add(lockKey);
    let operation = '';
    try {
      const selectedIndex = await this.showActionSheet(isAuthor ? ['删除内容', '举报'] : ['举报']);
      if (this._disposed || selectedIndex < 0) return;
      if (isAuthor && selectedIndex === 0) {
        operation = 'delete';
        if (!await this.confirmDelete() || this._disposed) return;
        if (targetType === 'communityPost') {
          await communityService.deletePost(targetId);
          if (!this._disposed) wx.switchTab({ url: '/pages/community/index' });
          return;
        }
        const deleted = await communityService.deleteReply(targetId);
        if (!this._disposed) this.setData({
          replies: this.data.replies.filter((item) => item.id !== targetId),
          'post.replyCount': Math.max(0, Number(deleted.replyCount) || 0),
          ...(this.data.replyTarget && this.data.replyTarget.id === targetId
            ? { replyTarget: null, replyPlaceholder: '写下你的回复…', replyCursorSpacing: 120 }
            : {})
        });
        return;
      }
      operation = 'report';
      if (!await this.ensureInteractionAccess() || this._disposed) return;
      const reasonIndex = await this.showActionSheet(COMMUNITY_REPORT_REASONS.map((item) => item.label));
      const reason = COMMUNITY_REPORT_REASONS[reasonIndex];
      if (!reason || this._disposed) return;
      await safetyService.report({ targetType, targetId, reason: reason.value, description: '' });
      if (!this._disposed) wx.showToast({ title: '已收到举报', icon: 'success' });
    } catch (error) {
      if (!this._disposed && !error.handled) wx.showToast({ title: operation === 'delete' ? '删除失败，请重试' : '举报失败，请重试', icon: 'none' });
    } finally {
      this._actionLocks.delete(lockKey);
    }
  },
  handleRetryDetail() { return this.loadDetail(false); },
  handleRetryLoadMore() { this.loadDetail(true); },
  handleLoadMore() { this.loadDetail(true); },
  handleBack() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    if (pages.length > 1) return wx.navigateBack({ delta: 1 });
    return wx.switchTab({ url: '/pages/community/index' });
  },
  handleBackToCommunity() { wx.switchTab({ url: '/pages/community/index' }); }
});

module.exports = { decorate, mergeReplies, splitContentSegments, formatCommunityTime };
