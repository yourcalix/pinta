'use strict';

const activityService = require('../../../services/activity');
const safetyService = require('../../../services/safety');
const { decorateActivity } = require('../../../utils/display');
const { mergeActivitiesById } = require('../../../utils/discover-list');

const PAGE_SIZE = 10;

function locationErrorState(error) {
  const text = String(error && (error.errMsg || error.message) || '');
  return /auth deny|authorize:fail|permission|denied|拒绝/i.test(text) ? 'denied' : 'error';
}

Page({
  data: {
    state: 'intro',
    radiusOptions: [{ value: 1000, label: '1km' }, { value: 3000, label: '3km' }, { value: 5000, label: '5km' }, { value: 10000, label: '10km' }],
    radiusMeters: 3000,
    typeOptions: [{ value: '', label: '全部' }, { value: 'companion', label: '拼同行' }, { value: 'sport', label: '拼运动' }, { value: 'food', label: '拼饭桌' }],
    type: '', activities: [], hasMore: false, loadingMore: false, loadMoreError: '', errorMessage: ''
  },

  onLoad() { this._skipFirstShow = true; },
  onShow() {
    if (this._skipFirstShow) { this._skipFirstShow = false; return; }
    if (!this._viewerLocation && ['success', 'empty'].includes(this.data.state)) this.setData({ state: 'intro', activities: [], hasMore: false });
  },
  onHide() { this.clearViewerLocation(); },
  onUnload() { this.clearViewerLocation(); },
  onReachBottom() { return this.loadMore(); },
  async onPullDownRefresh() {
    try { if (this._viewerLocation) await this.fetchNearby({ keepContent: true }); }
    finally { if (typeof wx.stopPullDownRefresh === 'function') wx.stopPullDownRefresh(); }
  },

  clearViewerLocation() { this._viewerLocation = null; this._requestSeq = (this._requestSeq || 0) + 1; },
  handleEnableLocation() { return this.locateAndLoad(); },
  locateAndLoad() {
    const sequence = (this._requestSeq = (this._requestSeq || 0) + 1);
    this.setData({ state: 'loading', activities: [], errorMessage: '', loadMoreError: '' });
    return new Promise((resolve) => {
      wx.getLocation({
        type: 'gcj02', isHighAccuracy: true,
        success: (position) => {
          if (sequence !== this._requestSeq) return resolve(false);
          this._viewerLocation = { latitude: Number(position.latitude), longitude: Number(position.longitude) };
          resolve(this.fetchNearby());
        },
        fail: (error) => {
          if (sequence !== this._requestSeq) return resolve(false);
          this._viewerLocation = null;
          const state = locationErrorState(error);
          this.setData({ state, errorMessage: state === 'denied' ? '未获取到定位权限' : '暂时无法获取位置，请稍后重试' });
          resolve(false);
        }
      });
    });
  },

  async fetchNearby(options = {}) {
    if (!this._viewerLocation) return false;
    const sequence = (this._requestSeq = (this._requestSeq || 0) + 1);
    if (!options.keepContent) this.setData({ state: 'loading', activities: [], hasMore: false, loadingMore: false, loadMoreError: '' });
    this._nextCursor = undefined;
    try {
      const result = await this.requestPage();
      if (sequence !== this._requestSeq) return false;
      const activities = safetyService.filterHiddenActivities(result.items || []).map(decorateActivity);
      this._nextCursor = result.nextCursor || undefined;
      this.setData({ state: activities.length ? 'success' : 'empty', activities, hasMore: Boolean(result.nextCursor), loadingMore: false, errorMessage: '', loadMoreError: '' });
      return true;
    } catch (error) {
      if (sequence !== this._requestSeq) return false;
      const unavailable = error && error.code === 'NEARBY_UNAVAILABLE';
      this.setData({ state: unavailable ? 'unavailable' : (options.keepContent && this.data.activities.length ? 'success' : 'error'), loadingMore: false, errorMessage: unavailable ? '附近活动服务正在准备中，请稍后重试' : '附近活动加载失败，请检查网络' });
      return false;
    }
  },

  requestPage(cursor) {
    return activityService.nearby({
      latitude: this._viewerLocation.latitude, longitude: this._viewerLocation.longitude,
      coordinateSystem: 'GCJ02', radiusMeters: this.data.radiusMeters,
      type: this.data.type || undefined, cursor: cursor || undefined, limit: PAGE_SIZE
    });
  },
  async loadMore() {
    if (!this._viewerLocation || !this._nextCursor || this.data.loadingMore || this.data.loadMoreError) return false;
    const sequence = this._requestSeq;
    this.setData({ loadingMore: true, loadMoreError: '' });
    try {
      const result = await this.requestPage(this._nextCursor);
      if (sequence !== this._requestSeq) return false;
      this._nextCursor = result.nextCursor || undefined;
      this.setData({ activities: mergeActivitiesById(this.data.activities, safetyService.filterHiddenActivities(result.items || []).map(decorateActivity)), hasMore: Boolean(result.nextCursor), loadingMore: false });
      return true;
    } catch (error) {
      if (sequence !== this._requestSeq) return false;
      this.setData({ loadingMore: false, loadMoreError: '加载更多失败，点击重试' });
      return false;
    }
  },
  handleRetryLoadMore() { this.setData({ loadMoreError: '' }); return this.loadMore(); },
  handleRadiusChange(event) { const radiusMeters = Number(event.currentTarget.dataset.value); if (radiusMeters === this.data.radiusMeters) return false; this.setData({ radiusMeters }); return this.fetchNearby(); },
  handleTypeChange(event) { const type = event.currentTarget.dataset.value || ''; if (type === this.data.type) return false; this.setData({ type }); return this.fetchNearby(); },
  handleExpandRadius() { const radiusMeters = this.data.radiusMeters < 5000 ? 5000 : 10000; this.setData({ radiusMeters }); return this.fetchNearby(); },
  handleOpenSettings() { wx.openSetting({ success: (result) => { if (result.authSetting && result.authSetting['scope.userLocation']) this.locateAndLoad(); } }); },
  handleAllActivities() { wx.redirectTo({ url: '/subpackages/activity/list/index' }); },
  handleCardSelect(event) { wx.navigateTo({ url: `/subpackages/activity/detail/index?id=${encodeURIComponent(event.detail.id)}` }); }
});
