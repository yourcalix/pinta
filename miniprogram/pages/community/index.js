'use strict';

const communityService = require('../../services/community');
const userService = require('../../services/user');
const { calculateContentTopInset } = require('../../utils/navigation-layout');
const { selectTab } = require('../../utils/tab-bar');

const PAGE_SIZE = 12;
const AVATAR_TONES = ['blue', 'purple', 'orange', 'green', 'teal'];

function decorate(item) {
  const timestamp = Date.parse(item.createdAt);
  const minutes = Number.isFinite(timestamp) ? Math.max(0, Math.floor((Date.now() - timestamp) / 60000)) : 0;
  const authorNickname = String(item.author && item.author.nickname || '拼吧用户').trim() || '拼吧用户';
  const avatarInitial = Array.from(authorNickname)[0] || '拼';
  const avatarTone = AVATAR_TONES[(avatarInitial.codePointAt(0) || 0) % AVATAR_TONES.length];
  const replyCount = Math.max(0, Number(item.replyCount) || 0);
  const timeLabel = minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes}分钟前` : minutes < 1440 ? `${Math.floor(minutes / 60)}小时前` : `${Math.floor(minutes / 1440)}天前`;
  return {
    ...item,
    authorNickname,
    avatarInitial,
    avatarTone,
    replyCount,
    timeLabel,
    accessibilityLabel: `${authorNickname}发布的讨论：${String(item.content || '').slice(0, 30)}，${timeLabel}，当前${replyCount}条回复，双击查看详情`
  };
}

Page({
  data: {
    contentTopInset: 88,
    posts: [],
    nextCursor: '',
    hasMore: true,
    loading: true,
    loadingMore: false,
    loadMoreError: '',
    error: ''
  },

  onLoad() {
    this.setData({ contentTopInset: calculateContentTopInset(typeof wx === 'undefined' ? null : wx) });
    this._skipFirstShow = true;
    return this.loadPosts(false);
  },

  onShow() {
    selectTab(this, 1);
    if (this._skipFirstShow) return void (this._skipFirstShow = false);
    return this.loadPosts(false, true);
  },

  onHide() { this._loadSeq = (this._loadSeq || 0) + 1; },
  onUnload() { this._loadSeq = (this._loadSeq || 0) + 1; },

  async onPullDownRefresh() {
    try { await this.loadPosts(false, true); } finally { wx.stopPullDownRefresh(); }
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading && !this.data.loadingMore && !this.data.loadMoreError) this.loadPosts(true);
  },

  async loadPosts(append, keepContent = false) {
    if (append && (!this.data.nextCursor || this.data.loadingMore)) return;
    if (append) this._loadSeq = this._loadSeq || 0;
    const seq = append ? this._loadSeq : (this._loadSeq = (this._loadSeq || 0) + 1);
    this.setData(append
      ? { loadingMore: true, loadMoreError: '' }
      : { loading: !keepContent, error: '', loadMoreError: '', ...(keepContent ? {} : { posts: [] }) });
    try {
      const result = await communityService.listPosts({ limit: PAGE_SIZE, cursor: append ? this.data.nextCursor : undefined });
      if (seq !== this._loadSeq) return;
      const incoming = (result.items || []).map(decorate);
      this.setData({
        posts: append ? [...this.data.posts, ...incoming] : incoming,
        nextCursor: result.nextCursor || '',
        hasMore: Boolean(result.nextCursor),
        loading: false,
        loadingMore: false,
        loadMoreError: '',
        error: ''
      });
    } catch (error) {
      if (seq !== this._loadSeq) return;
      if (append) {
        this.setData({ loadingMore: false, loadMoreError: '加载更多失败，请重试' });
        return;
      }
      this.setData({ loading: false, loadingMore: false, error: '讨论加载失败，请检查网络' });
    }
  },

  async handleCompose() {
    try {
      const user = await userService.login();
      if (!user.profileComplete) {
        wx.navigateTo({ url: `/subpackages/profile/edit/index?next=${encodeURIComponent('/subpackages/community/compose/index')}` });
        return;
      }
      wx.navigateTo({ url: '/subpackages/community/compose/index' });
    } catch (error) {
      if (!error.handled) wx.showToast({ title: error.message || '暂时无法登录', icon: 'none' });
    }
  },

  handlePost(event) {
    wx.navigateTo({ url: `/subpackages/community/detail/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` });
  },

  handleRetry() { this.loadPosts(false); },

  handleRetryLoadMore() { this.loadPosts(true); }
});
