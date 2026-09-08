'use strict';

const activityService = require('../../../services/activity');
const safetyService = require('../../../services/safety');
const { decorateActivity } = require('../../../utils/display');
const {
  mergeActivitiesById,
  expirationSchedule,
  removeLocallyExpiredRecruiting
} = require('../../../utils/discover-list');

const PAGE_SIZE = 10;
const MAX_HIDDEN_PAGE_SKIPS = 1;

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
    loading: true,
    loadingMore: false,
    hasMore: true,
    loadMoreError: '',
    error: '',
    largeTextMode: false
  },

  onLoad() {
    this.syncTextSizeMode();
    this._skipFirstShow = true;
    return this.fetchActivities({ mode: 'replace' });
  },

  onShow() {
    this.syncTextSizeMode();
    if (this._skipFirstShow) {
      this._skipFirstShow = false;
      return;
    }
    return this.fetchActivities({ mode: 'replace', keepContent: true });
  },

  onHide() {
    this._loadSeq = (this._loadSeq || 0) + 1;
    this.clearExpirationTimer();
  },

  onUnload() {
    this._loadSeq = (this._loadSeq || 0) + 1;
    this.clearExpirationTimer();
  },

  async onPullDownRefresh() {
    try {
      await this.fetchActivities({ mode: 'replace', keepContent: true, notifyFailure: true });
    } finally {
      if (typeof wx !== 'undefined' && typeof wx.stopPullDownRefresh === 'function') wx.stopPullDownRefresh();
    }
  },

  onReachBottom() {
    return this.loadMoreActivities();
  },

  async fetchActivities(options = {}) {
    const keepContent = options.keepContent === true;
    const loadSeq = (this._loadSeq = (this._loadSeq || 0) + 1);
    this.clearExpirationTimer();
    if (!keepContent) this._nextCursor = undefined;
    this.setData({
      loading: !keepContent || this.data.activities.length === 0,
      loadingMore: false,
      loadMoreError: '',
      error: '',
      ...(!keepContent ? { activities: [], hasMore: true } : {})
    });

    try {
      const snapshot = await this.requestActivityPage(undefined, true);
      if (loadSeq !== this._loadSeq) return false;
      this._nextCursor = snapshot.nextCursor || undefined;
      this.setData({
        activities: snapshot.activities,
        loading: false,
        hasMore: Boolean(snapshot.nextCursor),
        error: ''
      });
      this.scheduleExpirationRefresh(snapshot.activities);
      return true;
    } catch (error) {
      if (loadSeq !== this._loadSeq) return false;
      const hasContent = keepContent && this.data.activities.length > 0;
      this.setData({
        loading: false,
        error: hasContent ? '' : '活动列表加载失败，请检查网络'
      });
      this.scheduleExpirationRefresh(this.data.activities);
      if (hasContent && options.notifyFailure && (!error || !error.handled) && typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
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

  async loadMoreActivities() {
    if (this.data.loading || this.data.loadingMore || this.data.loadMoreError || !this.data.hasMore || !this._nextCursor) return false;
    const loadSeq = this._loadSeq || 0;
    const cursor = this._nextCursor;
    this.setData({ loadingMore: true, loadMoreError: '' });
    try {
      const snapshot = await this.requestActivityPage(cursor, true);
      if (loadSeq !== this._loadSeq) return false;
      this._nextCursor = snapshot.nextCursor || undefined;
      const activities = mergeActivitiesById(this.data.activities, snapshot.activities);
      this.setData({
        activities,
        loadingMore: false,
        hasMore: Boolean(snapshot.nextCursor),
        loadMoreError: ''
      });
      this.scheduleExpirationRefresh(activities);
      return true;
    } catch (error) {
      if (loadSeq !== this._loadSeq) return false;
      this.setData({ loadingMore: false, loadMoreError: '加载更多失败，点击重试' });
      this.scheduleExpirationRefresh(this.data.activities);
      return false;
    }
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

  handleTypeChange(event) {
    const type = event.currentTarget.dataset.value || '';
    if (type === this.data.type) return false;
    this.setData({ type, hasActiveFilters: hasActiveFilters({ ...this.data, type }) });
    return this.fetchActivities({ mode: 'replace' });
  },

  handleClearFilters() {
    this.setData({ type: '', keyword: '', appliedKeyword: '', hasActiveFilters: false });
    return this.fetchActivities({ mode: 'replace' });
  },

  handleRetry() {
    return this.fetchActivities({ mode: 'replace' });
  },

  handleRetryLoadMore() {
    this.setData({ loadMoreError: '' });
    return this.loadMoreActivities();
  },

  handleEmptyAction() {
    if (this.data.error) return this.handleRetry();
    if (this.data.hasActiveFilters) return this.handleClearFilters();
    wx.switchTab({ url: '/pages/publish/index' });
    return true;
  },

  handleCardSelect(event) {
    wx.navigateTo({ url: `/subpackages/activity/detail/index?id=${encodeURIComponent(event.detail.id)}` });
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
    const largeTextMode = Number.isFinite(fontSizeSetting) && fontSizeSetting > 16;
    if (largeTextMode !== this.data.largeTextMode) this.setData({ largeTextMode });
    return largeTextMode;
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
  }
});
