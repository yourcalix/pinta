'use strict';

const communityService = require('../../../services/community');
const userService = require('../../../services/user');
const safetyService = require('../../../services/safety');
const { formatDateTime } = require('../../../utils/date');

const PAGE_SIZE = 20;
const AVATAR_TONES = ['blue', 'purple', 'orange', 'green', 'teal'];
const REPORT_REASONS = [
  { label: '虚假或误导信息', value: 'FALSE_INFORMATION' },
  { label: '诈骗或广告导流', value: 'FRAUD_OR_DIVERSION' },
  { label: '骚扰或不当内容', value: 'HARASSMENT' },
  { label: '其他问题', value: 'OTHER' }
];

function decorate(item) {
  const nickname = String(item && item.author && item.author.nickname || '拼吧用户').trim() || '拼吧用户';
  const avatarInitial = Array.from(nickname)[0] || '拼';
  return {
    ...item,
    authorNickname: nickname,
    avatarInitial,
    avatarTone: AVATAR_TONES[(avatarInitial.codePointAt(0) || 0) % AVATAR_TONES.length],
    displayTime: formatDateTime(item && item.createdAt),
    likeCount: Math.max(0, Number(item && item.likeCount) || 0),
    viewerHasLiked: Boolean(item && item.viewerHasLiked),
    likePending: false
  };
}

function mergeReplies(current, incoming) {
  const map = new Map([...(current || []), ...(incoming || [])].map((item) => [item.id, item]));
  return [...map.values()].sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)) || String(left.id).localeCompare(String(right.id)));
}

Page({
  data: {
    postId: '', post: null, replies: [], replyContent: '', submitting: false,
    loading: true, error: '', nextCursor: '', hasMore: false,
    loadingMore: false, loadMoreError: '', likingMap: {}
  },

  onLoad(options) {
    this._disposed = false;
    this.setData({ postId: options.id || '' });
    return this.loadDetail(false);
  },
  onUnload() {
    this._disposed = true;
    this._loadSeq = (this._loadSeq || 0) + 1;
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
      if (!append) nextData.post = decorate(result.post);
      this.setData(nextData);
    } catch (error) {
      if (this._disposed || seq !== this._loadSeq) return;
      if (append) return void this.setData({ loadingMore: false, loadMoreError: '更多回复加载失败，请重试' });
      this.setData({ loading: false, loadingMore: false, post: null, replies: [], error: error.code === 'NOT_FOUND' ? '该讨论已被作者删除或不存在' : '讨论暂时无法查看，请稍后重试' });
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
  async handleReplyFocus() { await this.ensureInteractionAccess(); },

  async handleSendReply() {
    const content = this.data.replyContent.trim();
    if (!content || this.data.submitting || !await this.ensureInteractionAccess()) return;
    this.setData({ submitting: true });
    try {
      const result = await communityService.createReply(this.data.postId, content);
      this.setData({ replyContent: '', replies: mergeReplies(this.data.replies, [decorate(result.reply)]), 'post.replyCount': Math.max(0, Number(result.replyCount) || 0) });
    } catch (error) {
      if (!error.handled) wx.showToast({ title: error.message || '回复失败，请重试', icon: 'none' });
    } finally { this.setData({ submitting: false }); }
  },

  updateLikeTarget(targetType, targetId, patch) {
    if (targetType === 'post') return this.setData({ post: { ...this.data.post, ...patch } });
    this.setData({ replies: this.data.replies.map((item) => item.id === targetId ? { ...item, ...patch } : item) });
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
      this.setData({ likingMap: { ...this.data.likingMap, [key]: true } });
      this.updateLikeTarget(targetType, targetId, { viewerHasLiked: liked, likeCount: Math.max(0, before.likeCount + (liked ? 1 : -1)), likePending: true });
      const result = await communityService.setLike(targetType, targetId, liked);
      if (this._disposed) return;
      this.updateLikeTarget(targetType, targetId, { viewerHasLiked: result.liked, likeCount: result.likeCount, likePending: false });
      try { if (wx.vibrateShort) wx.vibrateShort({ type: 'light' }); } catch (error) {}
    } catch (error) {
      if (this._disposed) return;
      if (before) this.updateLikeTarget(targetType, targetId, { ...before, likePending: false });
      if (!error.handled) wx.showToast({ title: '点赞失败，请重试', icon: 'none' });
    } finally {
      this._likeLocks.delete(key);
      if (!this._disposed && this.data.likingMap[key]) {
        const likingMap = { ...this.data.likingMap };
        delete likingMap[key];
        this.setData({ likingMap });
      }
    }
  },

  handlePostMore() { this.showContentActions('communityPost', this.data.post.id, this.data.post.viewerIsAuthor); },
  handleReplyMore(event) {
    const item = this.data.replies.find((reply) => reply.id === event.currentTarget.dataset.id);
    if (item) this.showContentActions('communityReply', item.id, item.viewerIsAuthor);
  },
  showContentActions(targetType, targetId, isAuthor) {
    const itemList = isAuthor ? ['删除内容'] : REPORT_REASONS.map((item) => item.label);
    wx.showActionSheet({ itemList, success: (result) => isAuthor ? this.confirmDelete(targetType, targetId) : this.reportContent(targetType, targetId, REPORT_REASONS[result.tapIndex].value) });
  },
  confirmDelete(targetType, targetId) {
    wx.showModal({
      title: '确认删除', content: '删除后其他用户将无法再查看，且无法恢复。', confirmText: '删除', confirmColor: '#E5484D',
      success: async (result) => {
        if (!result.confirm) return;
        try {
          if (targetType === 'communityPost') {
            await communityService.deletePost(targetId);
            wx.switchTab({ url: '/pages/community/index' });
          } else {
            const deleted = await communityService.deleteReply(targetId);
            this.setData({ replies: this.data.replies.filter((item) => item.id !== targetId), 'post.replyCount': Math.max(0, Number(deleted.replyCount) || 0) });
          }
        } catch (error) { if (!error.handled) wx.showToast({ title: error.message || '删除失败', icon: 'none' }); }
      }
    });
  },
  async reportContent(targetType, targetId, reason) {
    if (!await this.ensureInteractionAccess()) return;
    try {
      await safetyService.report({ targetType, targetId, reason, description: '' });
      wx.showToast({ title: '已收到举报', icon: 'success' });
    } catch (error) { if (!error.handled) wx.showToast({ title: error.message || '举报失败', icon: 'none' }); }
  },
  handleRetryDetail() { this.loadDetail(false); },
  handleRetryLoadMore() { this.loadDetail(true); },
  handleLoadMore() { this.loadDetail(true); },
  handleBackToCommunity() { wx.switchTab({ url: '/pages/community/index' }); }
});

module.exports = { decorate, mergeReplies };
