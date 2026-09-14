'use strict';

const communityService = require('../../services/community');
const userService = require('../../services/user');
const safetyService = require('../../services/safety');
const { COMMUNITY_REPORT_REASONS } = require('../../utils/community-report-reasons');
const { calculateContentTopInset } = require('../../utils/navigation-layout');
const { selectTab } = require('../../utils/tab-bar');
const { normalizeAvatarSlots, fallbackAvatarSlot } = require('../../utils/passenger-avatar');
const { openCommunityAuthor } = require('../../utils/open-community-author');

const PAGE_SIZE = 12;
const AVATAR_TONES = ['blue', 'purple', 'orange', 'green', 'teal'];

function decorate(item) {
  const timestamp = Date.parse(item.createdAt);
  const minutes = Number.isFinite(timestamp) ? Math.max(0, Math.floor((Date.now() - timestamp) / 60000)) : 0;
  const authorNickname = String(item.author && item.author.nickname || '拼吧用户').trim() || '拼吧用户';
  const avatarInitial = Array.from(authorNickname)[0] || '拼';
  const avatarTone = AVATAR_TONES[(avatarInitial.codePointAt(0) || 0) % AVATAR_TONES.length];
  const avatarSlot = normalizeAvatarSlots([item.author && item.author.avatar], 1)[0];
  const replyCount = Math.max(0, Number(item.replyCount) || 0);
  const likeCount = Math.max(0, Number(item.likeCount) || 0);
  const viewerHasLiked = Boolean(item.viewerHasLiked);
  const timeLabel = minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes}分钟前` : minutes < 1440 ? `${Math.floor(minutes / 60)}小时前` : `${Math.floor(minutes / 1440)}天前`;
  return { ...item, avatarSlot, authorNickname, avatarInitial, avatarTone, replyCount, likeCount, viewerHasLiked, likePending: Boolean(item.likePending), timeLabel,
    accessibilityLabel: `${authorNickname}发布的讨论：${String(item.content || '').slice(0, 30)}，${timeLabel}，${likeCount}个赞，${replyCount}条回复，${viewerHasLiked ? '已点赞' : '未点赞'}，双击查看详情`
  };
}

Page({
  data: {
    contentTopInset: 88,
    keyword: '',
    appliedKeyword: '',
    posts: [],
    nextCursor: '',
    hasMore: true,
    loading: true,
    loadingMore: false,
    loadMoreError: '',
    error: ''
  },

  onLoad() {
    this._disposed = false;
    this.setData({ contentTopInset: calculateContentTopInset(typeof wx === 'undefined' ? null : wx) });
    this._skipFirstShow = true;
    return this.loadPosts(false);
  },

  onShow() {
    this._disposed = false;
    selectTab(this, 1);
    this.releaseCompanionNavigation();
    this._activityNavigationPending = false;
    this._authorNavPending = false;
    if (this._skipFirstShow) return void (this._skipFirstShow = false);
    return this.loadPosts(false, true);
  },

  onHide() {
    this._disposed = true;
    this._loadSeq = (this._loadSeq || 0) + 1;
    this.releaseCompanionNavigation();
  },

  onUnload() {
    this._disposed = true;
    this._loadSeq = (this._loadSeq || 0) + 1;
    if (this._likeLocks) this._likeLocks.clear();
    if (this._postActionLocks) this._postActionLocks.clear();
    if (this._deletedPostIds) this._deletedPostIds.clear();
    this.releaseCompanionNavigation();
  },

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
    const likes=this.data.posts
    this.setData(append
      ? { loadingMore: true, loadMoreError: '' }
      : { loading: !keepContent, error: '', loadMoreError: '', ...(keepContent ? {} : { posts: [] }) });
    try {
      const result = await communityService.listPosts({
        limit: PAGE_SIZE,
        cursor: append ? this.data.nextCursor : undefined,
        keyword: this.data.appliedKeyword || undefined
      });
      if (seq !== this._loadSeq) return;
      const currentById = new Map(this.data.posts.map((item) => [item.id, item]));
      const deletedPostIds = this._deletedPostIds || new Set();
      const incoming = (result.items || []).filter((item) => !deletedPostIds.has(item.id)).map(decorate).map((item) => {
        const now=currentById.get(item.id)
        if (!now) return item;
        const was=likes.find((entry)=>entry.id===item.id)
        return !was || now.likePending || now.viewerHasLiked !== was.viewerHasLiked || now.likeCount !== was.likeCount
          ? decorate({ ...item, viewerHasLiked: now.viewerHasLiked, likeCount: now.likeCount, likePending: now.likePending }) : item;
      });
      this.setData({
        posts: append ? [...this.data.posts, ...incoming.filter((item) => !currentById.has(item.id))] : incoming,
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
      this.setData({
        loading: false,
        loadingMore: false,
        error: this.data.appliedKeyword ? '网络连接较慢，请稍后重试' : '发现内容加载失败，请检查网络'
      });
    }
  },

  handleKeywordInput(event) {
    this.setData({ keyword: String(event.detail.value || '').slice(0, 30) });
  },

  handlePostAvatarError(event) {
    const id = String(event.currentTarget.dataset.id || '');
    if (!id) return;
    this.setData({ posts: this.data.posts.map((item) => {
      if (item.id !== id || item.avatarSlot.empty) return item;
      const avatarSlot = fallbackAvatarSlot(item.avatarSlot);
      return { ...item, avatarSlot: avatarSlot === item.avatarSlot ? { ...avatarSlot, src: '', empty: true } : avatarSlot };
    }) });
  },

  handleSearchSubmit() {
    const appliedKeyword = String(this.data.keyword || '').trim();
    if (this.data.loading && appliedKeyword === this.data.appliedKeyword) return;
    this.setData({ keyword: appliedKeyword, appliedKeyword });
    return this.loadPosts(false);
  },

  handleClearKeyword() {
    if (!this.data.keyword && !this.data.appliedKeyword) return;
    this.setData({ keyword: '', appliedKeyword: '' });
    return this.loadPosts(false);
  },

  handleResetSearch(){return this.handleClearKeyword()},

  async ensureInteractionAccess() {
    if (this._accessPromise) return this._accessPromise;
    this._accessPromise = userService.login()
      .then((user) => user.profileComplete ? true : (wx.navigateTo({ url: '/subpackages/profile/edit/index' }), false))
      .catch((error) => { if (!error.handled) wx.showToast({ title: error.message || '暂时无法登录', icon: 'none' }); return false; })
      .finally(() => { this._accessPromise = null; });
    return this._accessPromise;
  },

  updatePostLike(postId, viewerHasLiked, likeCount, likePending) {
    const index = this.data.posts.findIndex((item) => item.id === postId);
    if (index < 0) return false;
    const posts = [...this.data.posts];
    posts[index] = decorate({ ...posts[index], viewerHasLiked, likeCount, likePending });
    this.setData({ posts });
  },

  async handlePostLike(event) {
    const postId = String(event.currentTarget.dataset.id || '');
    if (!postId) return;
    this._likeLocks = this._likeLocks || new Set();
    const key = `post:${postId}`;
    if (this._likeLocks.has(key)) return;
    this._likeLocks.add(key);
    let before = null;
    try {
      if (!await this.ensureInteractionAccess()) return;
      const target = this.data.posts.find((item) => item.id === postId);
      if (!target) return;
      before = { liked: Boolean(target.viewerHasLiked), count: Math.max(0, Number(target.likeCount) || 0) };
      const liked = !before.liked;
      this.updatePostLike(postId, liked, before.count + (liked ? 1 : -1), true);
      const result = await communityService.setLike('post', postId, liked);
      const current = this.data.posts.find((item) => item.id === postId);
      if (!current || !current.likePending || current.viewerHasLiked !== liked) return;
      this.updatePostLike(postId, result.liked, result.likeCount, false);
    } catch (error) {
      const current = this.data.posts.find((item) => item.id === postId);
      if (before && current && current.likePending && current.viewerHasLiked !== before.liked) this.updatePostLike(postId, before.liked, before.count, false);
      if (!error.handled) wx.showToast({ title: '点赞失败，请重试', icon: 'none' });
    } finally {
      this._likeLocks.delete(key);
    }
  },

  showPostActionSheet(isAuthor) {
    const itemList = isAuthor ? ['删除内容', '举报'] : ['举报'];
    return new Promise((resolve) => {
      const options = {
        itemList,
        success: (result) => resolve(Number.isInteger(result.tapIndex) ? result.tapIndex : -1),
        fail: () => resolve(-1)
      };
      wx.showActionSheet(options);
    });
  },

  showPostReportReasonSheet() {
    return new Promise((resolve) => wx.showActionSheet({
      itemList: COMMUNITY_REPORT_REASONS.map((item) => item.label),
      success: (result) => resolve(Number.isInteger(result.tapIndex) ? result.tapIndex : -1),
      fail: () => resolve(-1)
    }));
  },

  confirmPostDelete() {
    return new Promise((resolve) => wx.showModal({
      title: '确认删除',
      content: '删除后其他用户将无法再查看，且无法恢复。',
      confirmText: '删除',
      confirmColor: '#E5484D',
      success: (result) => resolve(Boolean(result.confirm)),
      fail: () => resolve(false)
    }));
  },

  async handlePostAction(event) {
    const postId = String(event.currentTarget.dataset.id || '');
    const post = this.data.posts.find((item) => item.id === postId);
    if (!postId || !post) return;
    this._postActionLocks = this._postActionLocks || new Set();
    if (this._postActionLocks.has(postId)) return;
    this._postActionLocks.add(postId);
    let operation = '';
    try {
      const isAuthor = Boolean(post.viewerIsAuthor);
      const selectedIndex = await this.showPostActionSheet(isAuthor);
      if (selectedIndex < 0) return;
      if (isAuthor && selectedIndex === 0) {
        operation = 'delete';
        if (!await this.confirmPostDelete()) return;
        await communityService.deletePost(postId);
        this._deletedPostIds = this._deletedPostIds || new Set();
        this._deletedPostIds.add(postId);
        this.setData({ posts: this.data.posts.filter((item) => item.id !== postId) });
        wx.showToast({ title: '已删除', icon: 'success' });
        return;
      }
      operation = 'report';
      if (!await this.ensureInteractionAccess()) return;
      const reasonIndex = await this.showPostReportReasonSheet();
      const reason = COMMUNITY_REPORT_REASONS[reasonIndex];
      if (!reason) return;
      await safetyService.report({ targetType: 'communityPost', targetId: postId, reason: reason.value, description: '' });
      wx.showToast({ title: '已收到举报', icon: 'success' });
    } catch (error) {
      if (!error.handled) wx.showToast({ title: operation === 'delete' ? '删除失败，请重试' : '举报失败，请重试', icon: 'none' });
    } finally {
      this._postActionLocks.delete(postId);
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

  handleCompanionOrbit() {
    if (this._companionNavigationPending) return;
    this._companionNavigationPending = true;
    wx.navigateTo({
      url: '/subpackages/community/companion/index',
      fail: () => {
        this.releaseCompanionNavigation();
        wx.showToast({ title: '暂时无法连接搭子星球', icon: 'none' });
      }
    });
  },

  releaseCompanionNavigation() {
    this._companionNavigationPending = false;
  },

  handleMessages() {
    if (this._activityNavigationPending) return;
    this._activityNavigationPending = true;
    wx.navigateTo({
      url: '/subpackages/community/activity/index',
      fail: () => {
        this._activityNavigationPending = false;
        wx.showToast({ title: '暂时无法打开讨论动态', icon: 'none' });
      }
    });
  },

  handleTopicAction(event) {
    const action = String(event.currentTarget.dataset.action || '');
    if (action === 'companion') {
      this.handleCompanionOrbit();
      return;
    }
    if (action === 'guidelines') {
      this.handleGuidelines();
      return;
    }
    if (action === 'compose') this.handleCompose();
  },

  handlePost(e){const d=e.currentTarget.dataset,id=String(d.id||'').trim();if(id)wx.navigateTo({url:`/subpackages/community/detail/index?id=${encodeURIComponent(id)}${d.r==='1'?'&reply=1':''}`})},

  handleAuthorProfile(event) {
    const sourceId = String(event.currentTarget.dataset.id || '').trim();
    if (sourceId) return openCommunityAuthor(this, 'post', sourceId);
  },

  handleGuidelines() {
    if (typeof wx === 'undefined' || typeof wx.showModal !== 'function') return;
    wx.showModal({
      title: '拼吧发现守则',
      content: '请友善交流并保护个人隐私；不要发布联系方式、二维码、外链、引流、诈骗或其他违规内容。发现不当内容可进入详情举报。',
      showCancel: false,
      confirmText: '我知道了',
      confirmColor: '#16A36A'
    });
  },

  handleRetry(){this.loadPosts(false)},
  handleRetryLoadMore(){this.loadPosts(true)}
});
