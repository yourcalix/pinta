'use strict';

const activityService = require('../../services/activity');
const safetyService = require('../../services/safety');
const config = require('../../config/index');
const { decorateActivity } = require('../../utils/display');
const {
  mergeActivitiesById,
  expirationSchedule,
  removeLocallyExpiredRecruiting
} = require('../../utils/discover-list');

const PAGE_SIZE = 10;

Page({
  data: {
    city: config.demoCity,
    sceneTabs: [
      { value: '', label: '全部' },
      { value: 'ride', label: '拼车' },
      { value: 'product', label: '拼商品' },
      { value: 'buddy', label: '拼搭子' }
    ],
    currentType: '',
    keyword: '',
    appliedKeyword: '',
    activities: [],
    nextCursor: '',
    hasMore: true,
    loading: true,
    refreshing: false,
    loadingMore: false,
    loadMoreError: '',
    error: ''
  },

  onLoad() {
    this._skipFirstShow = true;
    return this.fetchActivities({ mode: 'replace' });
  },

  onShow() {
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
        city: this.data.city,
        type: this.data.currentType || undefined,
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

  handleTypeChange(event) {
    const currentType = event.currentTarget.dataset.value || '';
    if (currentType === this.data.currentType) return;
    this.setData({ currentType });
    this.fetchActivities({ mode: 'replace' });
  },

  handleKeywordInput(event) {
    this.setData({ keyword: event.detail.value });
  },

  handleSearch() {
    this.setData({ appliedKeyword: this.data.keyword.trim() });
    this.fetchActivities({ mode: 'replace' });
  },

  handleCardSelect(event) {
    wx.navigateTo({ url: `/subpackages/activity/detail/index?id=${event.detail.id}` });
  },

  handleEmptyAction() {
    if (this.data.error) return this.fetchActivities({ mode: 'replace' });
    if (this.data.hasMore) return this.fetchActivities({ mode: 'append', allowAutoFill: false });
    wx.switchTab({ url: '/pages/publish/index' });
  },

  handleRetryLoadMore() {
    this.fetchActivities({ mode: 'append', allowAutoFill: false });
  }
});
