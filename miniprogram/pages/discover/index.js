'use strict';

const activityService = require('../../services/activity');
const safetyService = require('../../services/safety');
const userService = require('../../services/user');
const { decorateActivity } = require('../../utils/display');
const { calculateContentTopInset } = require('../../utils/navigation-layout');
const {
  expirationSchedule,
  removeLocallyExpiredRecruiting
} = require('../../utils/discover-list');
const { resolveProfileAvatar } = require('../../utils/profile-avatar');
const { resolveBeijingGreeting } = require('../../utils/home-greeting');
const {
  TOTAL_BLOCKS,
  PRELOAD_BLOCKS,
  STEP_INTERVAL_MS,
  FINISH_GATE_MS,
  FINISH_INTERVAL_MS,
  DROP_DURATION_MS,
  HOLD_MS,
  FADE_MS,
  MAX_SPLASH_WAIT_MS
} = require('../../utils/launch-progress');
const { selectTab } = require('../../utils/tab-bar');

const PAGE_SIZE = 3;
const MAX_HIDDEN_PAGE_SKIPS = 1;
const LARGE_TEXT_FONT_SIZE = 20;
const DEFAULT_GREETING_AVATAR = '/assets/images/profile/profile-avatar-neutral-painted.png';

function hasActiveFilters(filters) {
  return Boolean(filters.type || filters.appliedKeyword);
}

Page({
  data: {
    greetingSalutation: '你好',
    greetingNickname: '搭子',
    greetingAvatarPath: DEFAULT_GREETING_AVATAR,
    greetingAvatarFallbackPath: DEFAULT_GREETING_AVATAR,
    searchPanelVisible: false,
    shortcutIconPaths: {
      activities: '/assets/images/home/shortcut-group.png',
      memories: '/assets/images/home/shortcut-memory.png',
      placeholder: '/assets/images/home/shortcut-placeholder.png'
    },
    typeOptions: [
      { value: '', label: '全部', iconSrc: '/assets/images/discover/filter-all.png' },
      { value: 'companion', label: '拼同行', iconSrc: '/assets/images/discover/filter-companion.png' },
      { value: 'sport', label: '拼运动', iconSrc: '/assets/images/discover/filter-sport.png' },
      { value: 'food', label: '拼饭桌', iconSrc: '/assets/images/discover/filter-food.png' }
    ],
    type: '',
    keyword: '',
    appliedKeyword: '',
    hasActiveFilters: false,
    activities: [],
    loading: true,
    refreshing: false,
    error: '',
    contentTopInset: 88,
    largeTextMode: false,
    launchSplashVisible: false,
    launchSplashExiting: false,
    launchProgress: 0
  },

  onLoad() {
    this.setData({
      contentTopInset: calculateContentTopInset(typeof wx === 'undefined' ? null : wx)
    });
    this.syncTextSizeMode();
    this.syncGreetingSalutation();
    this.syncGreetingProfile();
    this.loadGreetingProfile();
    this._skipFirstShow = true;
    this.startLaunchSplash();
    const activities = Promise.resolve(this.fetchActivities({ mode: 'replace' }))
      .finally(() => this.markLaunchSplashReady());
    return activities;
  },

  onShow() {
    this._allActivitiesNavigationPending = false;
    this._nearbyNavigationPending = false;
    this.releaseMemoriesNavigationLock();
    selectTab(this, 0);
    this.syncTextSizeMode();
    this.syncGreetingSalutation();
    this.syncGreetingProfile();
    if (this._skipFirstShow) {
      this._skipFirstShow = false;
      return;
    }
    return this.fetchActivities({ mode: 'replace', keepContent: true });
  },

  onHide() {
    this._loadSeq = (this._loadSeq || 0) + 1;
    this.invalidateGreetingProfileLoad();
    this._allActivitiesNavigationPending = false;
    this._nearbyNavigationPending = false;
    this.releaseMemoriesNavigationLock();
    this.clearExpirationTimer();
    this.teardownLaunchSplash(true);
  },

  onUnload() {
    this._loadSeq = (this._loadSeq || 0) + 1;
    this.invalidateGreetingProfileLoad();
    this._allActivitiesNavigationPending = false;
    this._nearbyNavigationPending = false;
    this.releaseMemoriesNavigationLock();
    this.clearExpirationTimer();
    this.teardownLaunchSplash(false);
  },

  async onPullDownRefresh() {
    try {
      await this.fetchActivities({ mode: 'replace', keepContent: true, notifyFailure: true });
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async fetchActivities(options = {}) {
    const keepContent = options.keepContent === true;
    const allowAutoFill = options.allowAutoFill !== false;
    const loadSeq = (this._loadSeq = (this._loadSeq || 0) + 1);
    this.clearExpirationTimer();
    const resetContent = !keepContent;
    this.setData({
      loading: resetContent || this.data.activities.length === 0,
      refreshing: true,
      error: '',
      ...(resetContent ? {
        activities: []
      } : {})
    });

    try {
      const snapshot = await this.requestActivityPage(undefined, allowAutoFill);
      if (loadSeq !== this._loadSeq) return false;

      const activities = snapshot.activities;
      this.setData({
        activities,
        loading: false,
        refreshing: false,
        error: ''
      });
      this.scheduleExpirationRefresh(activities);
      return true;
    } catch (error) {
      if (loadSeq !== this._loadSeq) return false;
      const hasContent = keepContent && this.data.activities.length > 0;
      this.setData({
        loading: false,
        refreshing: false,
        error: hasContent ? '' : '活动列表加载失败，请重试'
      });
      this.scheduleExpirationRefresh(this.data.activities);
      if (hasContent && options.notifyFailure && typeof wx.showToast === 'function') {
        wx.showToast({ title: '刷新失败，请稍后重试', icon: 'none' });
      }
      return false;
    }
  },

  async requestActivityPage(cursor, allowAutoFill) {
    let requestCursor = cursor || undefined;
    let skips = 0;
    while (true) {
      const result = await activityService.list({
        type: this.data.type || undefined,
        keyword: this.data.appliedKeyword || undefined,
        limit: PAGE_SIZE,
        cursor: requestCursor
      });
      const activities = safetyService
        .filterHiddenActivities(result.items || [])
        .slice(0, PAGE_SIZE)
        .map(decorateActivity);
      const nextCursor = result.nextCursor ? String(result.nextCursor) : '';
      if (activities.length || !nextCursor || !allowAutoFill || skips >= MAX_HIDDEN_PAGE_SKIPS) {
        return { activities, nextCursor };
      }
      requestCursor = nextCursor;
      skips += 1;
    }
  },

  scrollToHotPinba() {
    if (typeof wx === 'undefined' || typeof wx.pageScrollTo !== 'function') return;
    wx.pageScrollTo({ selector: '#hot-pinba-heading', duration: 200 });
  },

  scheduleExpirationRefresh(items) {
    this.clearExpirationTimer();
    const schedule = expirationSchedule(items);
    if (!schedule) return;
    this._nextExpirationAt = schedule.deadlineAt;
    this._expirationTimer = setTimeout(() => {
      this._expirationTimer = null;
      if (Date.now() < this._nextExpirationAt) {
        this.scheduleExpirationRefresh(this.data.activities);
        return;
      }
      const activities = removeLocallyExpiredRecruiting(this.data.activities);
      if (activities.length !== this.data.activities.length) this.setData({ activities });
      this.fetchActivities({ mode: 'replace', keepContent: true });
    }, schedule.delay);
  },

  clearExpirationTimer() {
    if (this._expirationTimer) clearTimeout(this._expirationTimer);
    this._expirationTimer = null;
  },

  startLaunchSplash() {
    const app = typeof getApp === 'function' ? getApp() : null;
    const globalData = app && app.globalData;
    if (!globalData || globalData.launchSplashShown) return false;

    globalData.launchSplashShown = true;
    this._launchSplashActive = true;
    this._launchSplashReady = false;
    this._launchSplashMinimumReached = false;
    this._launchSplashCompleting = false;
    this._launchTimers = new Set();
    this.setData({
      launchSplashVisible: true,
      launchSplashExiting: false,
      launchProgress: 0
    });
    this.hideLaunchTabBar();

    for (let progress = 1; progress <= PRELOAD_BLOCKS; progress += 1) {
      this.queueLaunchTimer(() => {
        if (!this._launchSplashActive) return;
        this.setData({ launchProgress: progress });
      }, (progress - 1) * STEP_INTERVAL_MS);
    }
    this.queueLaunchTimer(() => {
      if (!this._launchSplashActive) return;
      this._launchSplashMinimumReached = true;
      this.completeLaunchSplashWhenReady();
    }, FINISH_GATE_MS);
    this.queueLaunchTimer(() => {
      if (!this._launchSplashActive || this._launchSplashReady) return;
      this.teardownLaunchSplash(true);
    }, MAX_SPLASH_WAIT_MS);
    return true;
  },

  markLaunchSplashReady() {
    if (!this._launchSplashActive) return;
    this._launchSplashReady = true;
    this.completeLaunchSplashWhenReady();
  },

  completeLaunchSplashWhenReady() {
    if (
      !this._launchSplashActive
      || !this._launchSplashReady
      || !this._launchSplashMinimumReached
      || this._launchSplashCompleting
    ) return;

    this._launchSplashCompleting = true;
    for (let progress = PRELOAD_BLOCKS + 1; progress <= TOTAL_BLOCKS; progress += 1) {
      this.queueLaunchTimer(() => {
        if (this._launchSplashActive) this.setData({ launchProgress: progress });
      }, (progress - PRELOAD_BLOCKS - 1) * FINISH_INTERVAL_MS);
    }
    const fullAt = (TOTAL_BLOCKS - PRELOAD_BLOCKS - 1) * FINISH_INTERVAL_MS + DROP_DURATION_MS;
    this.queueLaunchTimer(() => {
      if (this._launchSplashActive) this.setData({ launchSplashExiting: true });
    }, fullAt + HOLD_MS);
    this.queueLaunchTimer(() => this.finishLaunchSplash(), fullAt + HOLD_MS + FADE_MS);
  },

  queueLaunchTimer(callback, delay) {
    if (!this._launchTimers) this._launchTimers = new Set();
    const timer = setTimeout(() => {
      this._launchTimers.delete(timer);
      callback();
    }, delay);
    this._launchTimers.add(timer);
    return timer;
  },

  clearLaunchTimers() {
    if (!this._launchTimers) return;
    this._launchTimers.forEach((timer) => clearTimeout(timer));
    this._launchTimers.clear();
  },

  handleLaunchAssetError() {
    this.teardownLaunchSplash(true);
  },

  setCustomTabBarHidden(hidden) {
    if (typeof this.getTabBar !== 'function') return false;
    try {
      const tabBar = this.getTabBar();
      if (!tabBar || typeof tabBar.setHidden !== 'function') return false;
      tabBar.setHidden(hidden);
      return true;
    } catch (error) {
      return false;
    }
  },

  hideLaunchTabBar() {
    this.setCustomTabBarHidden(true);
  },

  restoreLaunchTabBar() {
    this.setCustomTabBarHidden(false);
  },

  finishLaunchSplash() {
    if (!this._launchSplashActive) return;
    this._launchSplashActive = false;
    this.clearLaunchTimers();
    this.setData({
      launchSplashVisible: false,
      launchSplashExiting: false
    });
    this.restoreLaunchTabBar();
  },

  teardownLaunchSplash(updateView) {
    const wasActive = this._launchSplashActive === true;
    this._launchSplashActive = false;
    this.clearLaunchTimers();
    if (wasActive && updateView) {
      this.setData({
        launchSplashVisible: false,
        launchSplashExiting: false
      });
    }
    this.restoreLaunchTabBar();
  },

  handleTypeChange(event) {
    const type = event.currentTarget.dataset.value || '';
    if (type === this.data.type) return false;
    this.setData({
      type,
      hasActiveFilters: hasActiveFilters({ ...this.data, type })
    });
    return this.fetchActivities({ mode: 'replace' });
  },

  syncGreetingSalutation() {
    const greetingSalutation = resolveBeijingGreeting();
    if (greetingSalutation !== this.data.greetingSalutation) {
      this.setData({ greetingSalutation });
    }
  },

  syncGreetingProfile() {
    const app = typeof getApp === 'function' ? getApp() : null;
    const profile = app && app.globalData && app.globalData.user && app.globalData.user.profile;
    if (!profile) return false;
    return this.applyGreetingProfile(profile);
  },

  applyGreetingProfile(profile) {
    const nickname = String(profile && profile.nickname || '').trim();
    if (!nickname) return false;
    const avatar = resolveProfileAvatar(profile);
    const next = {
      greetingNickname: nickname,
      greetingAvatarPath: avatar.path || DEFAULT_GREETING_AVATAR,
      greetingAvatarFallbackPath: avatar.fallbackPath || DEFAULT_GREETING_AVATAR
    };
    if (
      next.greetingNickname !== this.data.greetingNickname
      || next.greetingAvatarPath !== this.data.greetingAvatarPath
      || next.greetingAvatarFallbackPath !== this.data.greetingAvatarFallbackPath
    ) {
      this.setData(next);
      return true;
    }
    return false;
  },

  async loadGreetingProfile() {
    const requestSeq = (this._greetingProfileSeq = (this._greetingProfileSeq || 0) + 1);
    try {
      const result = await userService.getProfile();
      if (requestSeq !== this._greetingProfileSeq) return false;
      const profile = result && result.user && result.user.profile;
      return this.applyGreetingProfile(profile);
    } catch (error) {
      return false;
    }
  },

  invalidateGreetingProfileLoad() {
    this._greetingProfileSeq = (this._greetingProfileSeq || 0) + 1;
  },

  handleGreetingAvatarError() {
    if (this.data.greetingAvatarPath === this.data.greetingAvatarFallbackPath) return;
    this.setData({ greetingAvatarPath: this.data.greetingAvatarFallbackPath });
  },

  syncTextSizeMode() {
    let info = null;
    try {
      if (typeof wx !== 'undefined' && typeof wx.getAppBaseInfo === 'function') info = wx.getAppBaseInfo();
      else if (typeof wx !== 'undefined' && typeof wx.getSystemInfoSync === 'function') info = wx.getSystemInfoSync();
    } catch (error) {
      info = null;
    }
    const fontSizeSetting = Number(info && info.fontSizeSetting);
    const largeTextMode = Number.isFinite(fontSizeSetting) && fontSizeSetting >= LARGE_TEXT_FONT_SIZE;
    if (largeTextMode !== this.data.largeTextMode) this.setData({ largeTextMode });
    return largeTextMode;
  },

  handleHeaderAction(event) {
    const action = event.currentTarget.dataset.action;
    if (action === 'messages') {
      wx.switchTab({ url: '/pages/messages/index' });
      return true;
    }
    if (action === 'search') {
      this.setData({ searchPanelVisible: !this.data.searchPanelVisible });
      return true;
    }
    return false;
  },

  handleCloseSearch() {
    if (!this.data.searchPanelVisible) return false;
    this.setData({ searchPanelVisible: false });
    return true;
  },

  handleHomeShortcut(event) {
    const action = event.currentTarget.dataset.action;
    if (action === 'activities') {
      if (this._allActivitiesNavigationPending) return false;
      this._allActivitiesNavigationPending = true;
      wx.navigateTo({
        url: '/subpackages/activity/list/index',
        fail: () => { this._allActivitiesNavigationPending = false; }
      });
      return true;
    }
    if (action === 'memories') {
      if (this._memoriesNavigationPending) return false;
      this._memoriesNavigationPending = true;
      this._memoriesNavigationTimer = setTimeout(() => {
        this._memoriesNavigationTimer = null;
        this._memoriesNavigationPending = false;
      }, 500);
      wx.navigateTo({
        url: '/subpackages/activity/memories/index',
        fail: () => {
          this.releaseMemoriesNavigationLock();
          if (typeof wx.showToast === 'function') {
            wx.showToast({ title: '页面打开失败，请稍后重试', icon: 'none' });
          }
        }
      });
      return true;
    }
    return false;
  },

  releaseMemoriesNavigationLock() {
    if (this._memoriesNavigationTimer) clearTimeout(this._memoriesNavigationTimer);
    this._memoriesNavigationTimer = null;
    this._memoriesNavigationPending = false;
  },

  handleNavigateToAll() {
    if (this._nearbyNavigationPending) return false;
    this._nearbyNavigationPending = true;
    wx.navigateTo({
      url: '/subpackages/activity/nearby/index',
      fail: () => { this._nearbyNavigationPending = false; }
    });
    return true;
  },

  handleKeywordInput(event) {
    this.setData({ keyword: event.detail.value });
  },

  handleSearch() {
    const appliedKeyword = this.data.keyword.trim();
    this.setData({
      appliedKeyword,
      hasActiveFilters: hasActiveFilters({ ...this.data, appliedKeyword })
    });
    return this.fetchActivities({ mode: 'replace' });
  },

  handleClearKeyword() {
    const shouldReload = Boolean(this.data.appliedKeyword);
    this.setData({
      keyword: '',
      appliedKeyword: '',
      hasActiveFilters: Boolean(this.data.type)
    });
    return shouldReload ? this.fetchActivities({ mode: 'replace' }) : false;
  },

  handleClearFilters() {
    this.setData({
      type: '',
      keyword: '',
      appliedKeyword: '',
      hasActiveFilters: false
    });
    return this.fetchActivities({ mode: 'replace' });
  },

  handleCardSelect(event) {
    wx.navigateTo({
      url: `/subpackages/activity/detail/index?id=${encodeURIComponent(event.detail.id)}`
    });
  },

  handleEmptyAction() {
    if (this.data.error) return this.fetchActivities({ mode: 'replace' });
    if (this.data.hasActiveFilters) return this.handleClearFilters();
    wx.switchTab({ url: '/pages/publish/index' });
  }
});
