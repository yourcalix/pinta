'use strict';

const communityService = require('../../services/community');
const userService = require('../../services/user');
const { calculateContentTopInset } = require('../../utils/navigation-layout');

const PAGE_SIZE = 12;
const AVATAR_PATHS = {
  PASSENGER_A: '../../assets/images/discover/avatar-passenger-a.png',
  PASSENGER_B: '../../assets/images/discover/avatar-passenger-b.png'
};

function decorate(item) {
  const timestamp = Date.parse(item.createdAt);
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  return {
    ...item,
    avatarPath: AVATAR_PATHS[item.author && item.author.avatarKind] || AVATAR_PATHS.PASSENGER_A,
    timeLabel: minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes}分钟前` : minutes < 1440 ? `${Math.floor(minutes / 60)}小时前` : `${Math.floor(minutes / 1440)}天前`,
    accessibilityLabel: `用户${item.author && item.author.nickname || '校园同学'}发布的讨论：${item.content.slice(0, 30)}，${item.replyCount || 0}条回复，点击查看详情`
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
    error: ''
  },

  onLoad() {
    this.setData({ contentTopInset: calculateContentTopInset(typeof wx === 'undefined' ? null : wx) });
    this._skipFirstShow = true;
    return this.loadPosts(false);
  },

  onShow() {
    if (this._skipFirstShow) return void (this._skipFirstShow = false);
    return this.loadPosts(false, true);
  },

  onHide() { this._loadSeq = (this._loadSeq || 0) + 1; },
  onUnload() { this._loadSeq = (this._loadSeq || 0) + 1; },

  async onPullDownRefresh() {
    try { await this.loadPosts(false, true); } finally { wx.stopPullDownRefresh(); }
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading && !this.data.loadingMore) this.loadPosts(true);
  },

  async loadPosts(append, keepContent = false) {
    if (append && (!this.data.nextCursor || this.data.loadingMore)) return;
    const seq = append ? (this._loadSeq || 0) : (this._loadSeq = (this._loadSeq || 0) + 1);
    this.setData(append ? { loadingMore: true } : { loading: !keepContent, error: '', ...(keepContent ? {} : { posts: [] }) });
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
        error: ''
      });
    } catch (error) {
      if (seq !== this._loadSeq) return;
      this.setData({ loading: false, loadingMore: false, error: error.message || '社区暂时无法加载' });
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

  handleRetry() { this.loadPosts(false); }
});
