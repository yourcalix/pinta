'use strict';

const api = require('../../services/api');
const userService = require('../../services/user');
const notificationRouter = require('../../services/notification-router');
const { decorateActivity } = require('../../utils/display');
const { formatDateTime } = require('../../utils/date');
const { calculateContentTopInset } = require('../../utils/navigation-layout');
const { profileAvatarPath } = require('../../utils/passenger-avatar');
const { resolveProfileAvatar } = require('../../utils/profile-avatar');
const { profileImagePreviewPath } = require('../../utils/profile-image-preview');
const {
  DEFAULT_PROFILE_COVER,
  DEFAULT_PROFILE_COVER_PATH,
  readProfileCover,
  resolveProfileCover
} = require('../../utils/profile-cover');
const { selectTab, refreshUnread } = require('../../utils/tab-bar');

const PROFILE_COVERS = Object.freeze({
  companion: '/assets/images/publish/publish-cover-companion.webp',
  sport: '/assets/images/publish/publish-cover-sport.webp',
  food: '/assets/images/publish/publish-cover-food.webp'
});
const WEEKDAYS = Object.freeze(['日', '一', '二', '三', '四', '五', '六']);

function profileActionPosition(platform) {
  try {
    const menuRect = platform.getMenuButtonBoundingClientRect();
    const windowWidth = platform.getWindowInfo().windowWidth;
    if (Number.isFinite(menuRect.top) && Number.isFinite(menuRect.left) && Number.isFinite(windowWidth)) {
      return { top: Math.max(0, Math.round(menuRect.top - 9)), right: Math.max(16, Math.round(windowWidth - menuRect.left + 8)) };
    }
  } catch (error) { return { top: 36, right: 112 }; }
  return { top: 36, right: 112 };
}

function decorateProfileActivity(activity) {
  const date = new Date(activity.startsAt);
  const validDate = Number.isFinite(date.getTime());
  const memberCount = Math.max(0, Number(activity.memberCount) || 0);
  return {
    ...activity,
    profileCover: PROFILE_COVERS[activity.typeTone] || PROFILE_COVERS.sport,
    timelineDate: validDate ? `${String(date.getMonth() + 1).padStart(2, '0')}月${String(date.getDate()).padStart(2, '0')}日` : '日期待定',
    timelineDay: validDate ? `周${WEEKDAYS[date.getDay()]}` : '',
    timelinePeopleLabel: memberCount > 1 ? `和${memberCount - 1}人一起拼` : '等待搭子加入'
  };
}

Page({
  data: {
    contentTopInset: 88,
    profileActionTop: 36,
    profileActionRight: 112,
    loading: true,
    error: '',
    user: null,
    profileAvatarPath: profileAvatarPath(null),
    avatarFallbackPath: profileAvatarPath(null),
    hasCustomAvatar: false,
    currentCoverType: DEFAULT_PROFILE_COVER,
    profileCoverPath: DEFAULT_PROFILE_COVER_PATH,
    profileCoverUsesAvatar: false,
    profileGenderLabel: '性别未设置',
    profileIntro: '添加兴趣标签，让搭子更快认识你',
    hasProfileIntro: false,
    currentList: 'owned',
    owned: [], joined: [], formed: [], history: [], currentItems: [], tasks: [],
    isMock: api.isMock(),
    persona: api.getMockPersona(),
    personas: [
      { id: 'u_owner', label: '发起者“小拼”' },
      { id: 'u_member', label: '参与者“阿同”' },
      { id: 'u_student', label: '普通用户“小满”' }
    ]
  },

  onLoad() {
    const platform = typeof wx === 'undefined' ? null : wx;
    const actionPosition = profileActionPosition(platform);
    this.setData({
      contentTopInset: calculateContentTopInset(platform),
      profileActionTop: actionPosition.top,
      profileActionRight: actionPosition.right
    });
  },

  onShow() {
    this.refreshProfileCover();
    selectTab(this, 4);
    refreshUnread(this);
    return this.loadDashboard();
  },

  async loadDashboard() {
    const seq = (this._loadSeq = (this._loadSeq || 0) + 1);
    this.setData({ loading: true, error: '' });
    try {
      const user = await userService.login();
      const [mineResult, notificationResult] = await Promise.allSettled([
        userService.mine(),
        userService.notifications()
      ]);
      if (mineResult.status === 'rejected') throw mineResult.reason;
      const mine = mineResult.value || { owned: [], joined: [] };
      const notifications = notificationResult.status === 'fulfilled'
        ? notificationResult.value || { items: [] }
        : { items: [] };
      if (seq !== this._loadSeq) return;
      const owned = (mine.owned || []).map((item) => decorateProfileActivity(decorateActivity(item)));
      const joined = (mine.joined || []).map((item) => decorateProfileActivity(decorateActivity(item)));
      const all = [...owned, ...joined];
      const formed = all.filter((item) => ['FORMED', 'IN_PROGRESS'].includes(item.status));
      const history = all.filter((item) => ['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(item.status));
      const lists = { owned, joined, formed, history };
      const interests = user.profile && Array.isArray(user.profile.interests)
        ? user.profile.interests.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 3)
        : [];
      const avatar = resolveProfileAvatar(user.profile);
      const cover = resolveProfileCover(readProfileCover(wx), avatar.path);
      this.setData({
        user,
        profileAvatarPath: avatar.path,
        avatarFallbackPath: avatar.fallbackPath,
        hasCustomAvatar: avatar.custom,
        currentCoverType: cover.key,
        profileCoverPath: cover.path,
        profileCoverUsesAvatar: cover.usesAvatar,
        profileGenderLabel: user.profile && user.profile.gender === 'MALE' ? '男' : user.profile && user.profile.gender === 'FEMALE' ? '女' : '性别未设置',
        profileIntro: interests.length ? interests.join(' · ') : '添加兴趣标签，让搭子更快认识你',
        hasProfileIntro: interests.length > 0,
        owned,
        joined,
        formed,
        history,
        currentItems: lists[this.data.currentList] || owned,
        tasks: (notifications.items || []).filter((item) => !item.read).map((item) => ({ ...item, displayTime: formatDateTime(item.createdAt), actionLabel: '去处理' })),
        persona: api.getMockPersona(),
        loading: false
      });
    } catch (error) {
      if (seq !== this._loadSeq) return;
      this.setData({ loading: false, error: error.handled ? '账号暂时无法使用' : error.message || '加载失败，请重试' });
    }
  },

  refreshProfileCover() {
    const cover = resolveProfileCover(readProfileCover(typeof wx === 'undefined' ? null : wx), this.data.profileAvatarPath);
    this.setData({
      currentCoverType: cover.key,
      profileCoverPath: cover.path,
      profileCoverUsesAvatar: cover.usesAvatar
    });
  },

  handleListChange(event) {
    const currentList = event.currentTarget.dataset.value || 'owned';
    this.setData({ currentList, currentItems: this.data[currentList] || [] });
  },

  handleMetricTap(event) {
    const currentList = event.currentTarget.dataset.value || 'owned';
    this.setData({ currentList, currentItems: this.data[currentList] || [] }, () => {
      if (typeof wx !== 'undefined' && typeof wx.pageScrollTo === 'function') {
        wx.pageScrollTo({ selector: '#my-activities', duration: 260 });
      }
    });
  },

  handleActivitySelect(event) {
    const id = event.detail && event.detail.id;
    this.openActivity(id);
  },

  handleActivityTap(event) {
    this.openActivity(event.currentTarget.dataset.id);
  },

  openActivity(id) {
    const item = [...this.data.owned, ...this.data.joined].find((activity) => activity.id === id);
    if (!item) return;
    const activityId = encodeURIComponent(item.id);
    if (item.viewerRole === 'owner' && item.status === 'RECRUITING') return wx.navigateTo({ url: `/subpackages/activity/manage/index?id=${activityId}` });
    if (['FORMED', 'IN_PROGRESS'].includes(item.status) && ['owner', 'member'].includes(item.viewerRole)) return wx.navigateTo({ url: `/subpackages/activity/group/index?id=${activityId}` });
    wx.navigateTo({ url: `/subpackages/activity/detail/index?id=${activityId}` });
  },

  async handleTaskTap(event) {
    const task = event.currentTarget.dataset.task;
    try { await userService.readNotification(task.id); } catch (error) { if (error.handled) return; }
    const url = notificationRouter.resolveNotificationPath(task);
    if (url === '/pages/discover/index') return wx.switchTab({ url });
    wx.navigateTo({ url });
  },

  previewProfileImage(imagePath, label) {
    if (this._isPreviewing || !imagePath || typeof wx === 'undefined' || typeof wx.previewImage !== 'function') return;
    this._isPreviewing = true;
    clearTimeout(this._previewUnlockTimer);
    this._previewUnlockTimer = setTimeout(() => {
      this._isPreviewing = false;
      this._previewUnlockTimer = null;
    }, 1000);
    const showError = () => {
      clearTimeout(this._previewUnlockTimer);
      this._previewUnlockTimer = null;
      this._isPreviewing = false;
      wx.showToast({ title: `${label}暂时无法查看`, icon: 'none' });
    };
    const openPreview = (resolvedPath) => wx.previewImage({
      current: resolvedPath,
      urls: [resolvedPath],
      showmenu: false,
      fail: showError
    });
    if (typeof wx.getImageInfo !== 'function') {
      openPreview(imagePath);
      return;
    }
    wx.getImageInfo({
      src: imagePath,
      success: (result) => openPreview(result.path || imagePath),
      fail: showError
    });
  },

  handleAvatarPreview() {
    this.previewProfileImage(profileImagePreviewPath(this.data.profileAvatarPath), '头像');
  },

  handleAvatarImageError() {
    if (this.data.profileAvatarPath === this.data.avatarFallbackPath) return;
    const cover = resolveProfileCover(this.data.currentCoverType, this.data.avatarFallbackPath);
    this.setData({ profileAvatarPath: this.data.avatarFallbackPath, profileCoverPath: cover.path });
  },

  handleBackgroundPreview() {
    this.previewProfileImage(profileImagePreviewPath(this.data.profileCoverPath), '背景');
  },

  handleProfile() { wx.navigateTo({ url: '/subpackages/profile/edit/index' }); },

  handleGoDiscover() { wx.switchTab({ url: '/pages/discover/index' }); },

  handlePersona(event) {
    if (!api.setMockPersona(event.currentTarget.dataset.id)) return;
    getApp().globalData.user = null;
    this.loadDashboard();
  },

  handleResetDemo() {
    wx.showModal({ title: '重置演示数据？', content: '会恢复示例活动和初始申请。', confirmText: '重置', success: (result) => { if (result.confirm) { api.resetMock(); getApp().globalData.user = null; this.loadDashboard(); } } });
  },

  onHide() {
    this._loadSeq = (this._loadSeq || 0) + 1;
  },

  onUnload() {
    this._loadSeq = (this._loadSeq || 0) + 1;
    clearTimeout(this._previewUnlockTimer);
    this._previewUnlockTimer = null;
    this._isPreviewing = false;
  }
});
