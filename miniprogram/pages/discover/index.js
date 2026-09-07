'use strict';

const activityService = require('../../services/activity');
const safetyService = require('../../services/safety');
const { decorateActivity } = require('../../utils/display');
const { calculateContentTopInset } = require('../../utils/navigation-layout');
const {
  expirationSchedule,
  removeLocallyExpiredRecruiting
} = require('../../utils/discover-list');
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

const PAGE_SIZE = 5;
const MAX_HIDDEN_PAGE_SKIPS = 1;
const BANNER_ROUTE_WHITELIST = new Set(['/pages/publish/index']);
const CAMPAIGN_ART = Object.freeze({
  companion: '/assets/images/publish/publish-cover-companion.png',
  sport: '/assets/images/publish/publish-cover-sport.png',
  food: '/assets/images/publish/publish-cover-food.png'
});
const CAMPAIGN_BANNERS = Object.freeze([
  {
    id: 'weekend-sport',
    tone: 'sport',
    eyebrow: '周末提案',
    title: '周末羽毛球新人局',
    subtitle: '新手友好 · 一起轻松开打',
    imageSrc: CAMPAIGN_ART.sport,
    action: { kind: 'filter', value: 'sport' }
  },
  {
    id: 'city-walk',
    tone: 'companion',
    eyebrow: '结伴探索',
    title: '发现城市里的新路线',
    subtitle: '周末漫步 · 找到同频搭子',
    imageSrc: CAMPAIGN_ART.companion,
    action: { kind: 'filter', value: 'companion' }
  },
  {
    id: 'publish-guide',
    tone: 'guide',
    eyebrow: '拼吧指南',
    title: '第一次发起拼单？',
    subtitle: '填写真实信息 · 安心结伴同行',
    imageSrc: CAMPAIGN_ART.food,
    action: { kind: 'route', value: '/pages/publish/index' }
  }
]);

function hasActiveFilters(filters) {
  return Boolean(filters.type || filters.appliedKeyword);
}

Page({
  data: {
    banners: CAMPAIGN_BANNERS.map((item) => ({ ...item, failed: false })),
    currentBanner: 0,
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
    currentPage: 1,
    hasNextPage: false,
    hasPagination: false,
    isPaging: false,
    loading: true,
    refreshing: false,
    error: '',
    contentTopInset: 88,
    launchSplashVisible: false,
    launchSplashExiting: false,
    launchProgress: 0
  },

  onLoad() {
    this.setData({
      contentTopInset: calculateContentTopInset(typeof wx === 'undefined' ? null : wx)
    });
    this._skipFirstShow = true;
    this.startLaunchSplash();
    const activities = Promise.resolve(this.fetchActivities({ mode: 'replace' }))
      .finally(() => this.markLaunchSplashReady());
    return activities;
  },

  onShow() {
    selectTab(this, 0);
    if (this._skipFirstShow) {
      this._skipFirstShow = false;
      return;
    }
    return this.fetchActivities({ mode: 'replace', keepContent: true });
  },

  onHide() {
    this._loadSeq = (this._loadSeq || 0) + 1;
    this.clearExpirationTimer();
    this.teardownLaunchSplash(true);
  },

  onUnload() {
    this._loadSeq = (this._loadSeq || 0) + 1;
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
    if (resetContent) this.resetPaginationCache();
    this.setData({
      loading: resetContent || this.data.activities.length === 0,
      refreshing: true,
      isPaging: false,
      error: '',
      ...(resetContent ? {
        activities: [],
        currentPage: 1,
        hasNextPage: false,
        hasPagination: false
      } : {})
    });

    try {
      const snapshot = await this.requestActivityPage(undefined, allowAutoFill);
      if (loadSeq !== this._loadSeq) return false;

      this._pageCache = [snapshot];
      this._pageCursors = [undefined];
      if (snapshot.nextCursor) this._pageCursors[1] = snapshot.nextCursor;
      const activities = snapshot.activities;
      const hasNextPage = Boolean(snapshot.nextCursor);
      this.setData({
        activities,
        currentPage: 1,
        hasNextPage,
        hasPagination: hasNextPage,
        loading: false,
        refreshing: false,
        isPaging: false,
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
        isPaging: false,
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

  resetPaginationCache() {
    this._pageCache = [];
    this._pageCursors = [undefined];
  },

  applyPage(pageIndex, snapshot, shouldScroll) {
    const currentPage = pageIndex + 1;
    const hasNextPage = Boolean(snapshot.nextCursor || this._pageCache[pageIndex + 1]);
    this.setData({
      activities: snapshot.activities,
      currentPage,
      hasNextPage,
      hasPagination: currentPage > 1 || hasNextPage,
      isPaging: false,
      error: ''
    });
    this.scheduleExpirationRefresh(snapshot.activities);
    if (shouldScroll) this.scrollToHotPinba();
  },

  scrollToHotPinba() {
    if (typeof wx === 'undefined' || typeof wx.pageScrollTo !== 'function') return;
    wx.pageScrollTo({ selector: '#hot-pinba-heading', duration: 200 });
  },

  handlePrevPage() {
    if (this.data.loading || this.data.refreshing || this.data.isPaging || this.data.currentPage <= 1) return false;
    const pageIndex = this.data.currentPage - 2;
    const snapshot = this._pageCache && this._pageCache[pageIndex];
    if (!snapshot) return false;
    this.applyPage(pageIndex, snapshot, true);
    return true;
  },

  handleNextPage() {
    if (this.data.loading || this.data.refreshing || this.data.isPaging || !this.data.hasNextPage) return false;
    const pageIndex = this.data.currentPage;
    const cached = this._pageCache && this._pageCache[pageIndex];
    if (cached) {
      this.applyPage(pageIndex, cached, true);
      return true;
    }

    const cursor = this._pageCursors && this._pageCursors[pageIndex];
    if (!cursor) return false;
    this._loadSeq = this._loadSeq || 0;
    const loadSeq = this._loadSeq;
    this.setData({ isPaging: true });
    return this.loadNextPage(pageIndex, cursor, loadSeq);
  },

  async loadNextPage(pageIndex, cursor, loadSeq) {
    try {
      const snapshot = await this.requestActivityPage(cursor, true);
      if (loadSeq !== this._loadSeq) return false;
      if (!snapshot.activities.length) {
        this._pageCursors[pageIndex] = snapshot.nextCursor || undefined;
        if (!snapshot.nextCursor) {
          const currentIndex = this.data.currentPage - 1;
          if (this._pageCache[currentIndex]) this._pageCache[currentIndex].nextCursor = '';
          this.setData({ hasNextPage: false, hasPagination: this.data.currentPage > 1, isPaging: false });
        } else {
          this.setData({ isPaging: false });
          if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
            wx.showToast({ title: '本页暂无可显示活动，请继续翻页', icon: 'none' });
          }
        }
        return false;
      }

      this._pageCache[pageIndex] = snapshot;
      if (snapshot.nextCursor) this._pageCursors[pageIndex + 1] = snapshot.nextCursor;
      else this._pageCursors.length = pageIndex + 1;
      this.applyPage(pageIndex, snapshot, true);
      return true;
    } catch (error) {
      if (loadSeq !== this._loadSeq) return false;
      this.setData({ isPaging: false });
      this.scheduleExpirationRefresh(this.data.activities);
      if ((!error || !error.handled) && typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
        wx.showToast({ title: '加载失败，请重试', icon: 'none' });
      }
      return false;
    }
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

  handleBannerChange(event) {
    const currentBanner = Math.max(0, Number(event.detail && event.detail.current) || 0);
    if (currentBanner !== this.data.currentBanner) this.setData({ currentBanner });
  },

  handleBannerTap(event) {
    const banner = this.data.banners.find((item) => item.id === event.currentTarget.dataset.id);
    if (!banner || !banner.action) return false;
    if (banner.action.kind === 'filter' && ['', 'companion', 'sport', 'food'].includes(banner.action.value)) {
      const type = banner.action.value;
      this.setData({ type, hasActiveFilters: hasActiveFilters({ ...this.data, type }) });
      return this.fetchActivities({ mode: 'replace' });
    }
    if (banner.action.kind === 'route' && BANNER_ROUTE_WHITELIST.has(banner.action.value)) {
      wx.switchTab({ url: banner.action.value });
      return true;
    }
    return false;
  },

  handleBannerImageError(event) {
    const id = event.currentTarget.dataset.id;
    const index = this.data.banners.findIndex((item) => item.id === id);
    if (index < 0 || this.data.banners[index].failed) return;
    this.setData({ [`banners[${index}].failed`]: true });
  },

  handleHeaderAction(event) {
    const action = event.currentTarget.dataset.action;
    if (action === 'messages') {
      wx.switchTab({ url: '/pages/messages/index' });
      return true;
    }
    if (action === 'search' && typeof wx !== 'undefined' && typeof wx.pageScrollTo === 'function') {
      wx.pageScrollTo({ selector: '#home-directory-tools', duration: 200 });
      return true;
    }
    return false;
  },

  handleHomeShortcut(event) {
    const action = event.currentTarget.dataset.action;
    if (action === 'activities') {
      this.scrollToHotPinba();
      return true;
    }
    if (action === 'community') {
      wx.switchTab({ url: '/pages/community/index' });
      return true;
    }
    if (action === 'publish') {
      wx.switchTab({ url: '/pages/publish/index' });
      return true;
    }
    return false;
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
    if (this.data.hasNextPage) return this.handleNextPage();
    wx.switchTab({ url: '/pages/publish/index' });
  }
});
