'use strict';

const activityService = require('../../services/activity');
const safetyService = require('../../services/safety');
const { decorateActivity } = require('../../utils/display');
const { calculateContentTopInset } = require('../../utils/navigation-layout');
const {
  mergeActivitiesById,
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

const PAGE_SIZE = 10;

function hasActiveFilters(filters) {
  return Boolean(filters.type || filters.appliedKeyword);
}

Page({
  data: {
    typeOptions: [
      { value: '', label: '全部' },
      { value: 'companion', label: '拼同行' },
      { value: 'sport', label: '拼运动' },
      { value: 'food', label: '拼饭桌' }
    ],
    type: '',
    keyword: '',
    appliedKeyword: '',
    hasActiveFilters: false,
    activities: [],
    nextCursor: '',
    hasMore: true,
    loading: true,
    refreshing: false,
    loadingMore: false,
    loadMoreError: '',
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
    return Promise.resolve(this.fetchActivities({ mode: 'replace' }))
      .finally(() => this.markLaunchSplashReady());
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

  onReachBottom() {
    if (this.data.loading || this.data.refreshing || this.data.loadingMore || !this.data.hasMore || this.data.error) return;
    this.fetchActivities({ mode: 'append' });
  },

  async fetchActivities(options = {}) {
    const mode = options.mode === 'append' ? 'append' : 'replace';
    const isAppend = mode === 'append';
    const keepContent = options.keepContent === true;
    const allowAutoFill = options.allowAutoFill !== false;
    if (isAppend && (
      this.data.loading
      || this.data.refreshing
      || this.data.loadingMore
      || !this.data.hasMore
      || !this.data.nextCursor
    )) return false;

    let loadSeq;
    let cursor;
    if (isAppend) {
      this._loadSeq = this._loadSeq || 0;
      loadSeq = this._loadSeq;
      cursor = this.data.nextCursor;
      this.setData({
        loading: this.data.activities.length === 0,
        loadingMore: true,
        loadMoreError: ''
      });
    } else {
      loadSeq = (this._loadSeq = (this._loadSeq || 0) + 1);
      this.clearExpirationTimer();
      const resetContent = !keepContent;
      this.setData({
        loading: resetContent || this.data.activities.length === 0,
        refreshing: true,
        loadingMore: false,
        loadMoreError: '',
        error: '',
        ...(resetContent ? { activities: [], nextCursor: '', hasMore: true } : {})
      });
    }

    try {
      const result = await activityService.list({
        type: this.data.type || undefined,
        keyword: this.data.appliedKeyword || undefined,
        limit: PAGE_SIZE,
        cursor: isAppend ? cursor : undefined
      });
      if (loadSeq !== this._loadSeq) return false;

      const incoming = safetyService
        .filterHiddenActivities(result.items || [])
        .map(decorateActivity);
      const nextCursor = result.nextCursor ? String(result.nextCursor) : '';
      const hasMore = Boolean(nextCursor);
      const activities = isAppend
        ? mergeActivitiesById(this.data.activities, incoming)
        : incoming;
      this.setData({
        activities,
        nextCursor,
        hasMore,
        loading: false,
        refreshing: false,
        loadingMore: false,
        loadMoreError: '',
        error: ''
      });

      if (activities.length === 0 && hasMore && allowAutoFill) {
        return this.fetchActivities({ mode: 'append', allowAutoFill: false });
      }
      this.scheduleExpirationRefresh(activities);
      return true;
    } catch (error) {
      if (loadSeq !== this._loadSeq) return false;
      if (isAppend) {
        this.setData({
          loading: false,
          loadingMore: false,
          loadMoreError: '加载更多失败，请重试'
        });
        this.scheduleExpirationRefresh(this.data.activities);
        return false;
      }

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

  hideLaunchTabBar() {
    if (typeof wx === 'undefined' || typeof wx.hideTabBar !== 'function') return;
    try {
      wx.hideTabBar({ animation: false });
      this._launchTabBarHidden = true;
    } catch (error) {
      this._launchTabBarHidden = false;
    }
  },

  restoreLaunchTabBar() {
    if (!this._launchTabBarHidden) return;
    this._launchTabBarHidden = false;
    if (typeof wx === 'undefined' || typeof wx.showTabBar !== 'function') return;
    try {
      wx.showTabBar({ animation: false });
    } catch (error) {
      // The page may already be leaving; the next Tab page restores native UI.
    }
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
    if (this.data.hasMore) return this.fetchActivities({ mode: 'append', allowAutoFill: false });
    wx.switchTab({ url: '/pages/publish/index' });
  },

  handleRetryLoadMore() {
    this.fetchActivities({ mode: 'append', allowAutoFill: false });
  }
});
