'use strict';

const activityService = require('../../../services/activity');
const safetyService = require('../../../services/safety');
const { decorateActivity } = require('../../../utils/display');
const { mergeActivitiesById } = require('../../../utils/discover-list');

const PAGE_SIZE = 10;
const EMPTY_MODAL = Object.freeze({ visible: false, type: 'location', title: '', description: '', confirmText: '', cancelText: '', danger: false, loading: false, closeOnMask: true });

function modalState(patch = {}) { return { ...EMPTY_MODAL, ...patch }; }

function locationErrorState(error) {
  const text = String(error && (error.errMsg || error.message) || '');
  return /auth deny|authorize:fail|permission|denied|拒绝/i.test(text) ? 'denied' : 'error';
}

Page({
  data: {
    state: 'intro',
    radiusOptions: [{ value: 1000, label: '1km' }, { value: 3000, label: '3km' }, { value: 5000, label: '5km' }, { value: 10000, label: '10km' }],
    radiusMeters: 3000,
    typeOptions: [{ value: '', label: '全部' }, { value: 'companion', label: '拼同行' }, { value: 'sport', label: '拼运动' }, { value: 'food', label: '拼饭桌' }, { value: 'benefit', label: '拼享惠' }],
    type: '', activities: [], hasMore: false, loadingMore: false, loadMoreError: '', errorMessage: '',
    modal: modalState()
  },

  onLoad() { this._disposed = false; this._unloaded = false; this._skipFirstShow = true; },
  onShow() {
    this._disposed = false;
    if (this._resumeLocationSettingResult) {
      const result = this._resumeLocationSettingResult;
      this._resumeLocationSettingResult = null;
      this._locateAfterModal = false;
      this.setData({
        modal: modalState(),
        ...(!result.granted ? { state: 'denied', errorMessage: result.errorMessage || '仍未开启定位权限，可随时查看全城活动' } : {})
      });
      if (result.granted) return void this.locateAndLoad();
    }
    if (this._skipFirstShow) { this._skipFirstShow = false; return; }
    if (!this._viewerLocation && ['success', 'empty'].includes(this.data.state)) this.setData({ state: 'intro', activities: [], hasMore: false });
  },
  onHide() {
    if (this.data.modal.visible && !this._locationSettingsPending) this.setData({ modal: { ...this.data.modal, visible: false, loading: false } });
    this._disposed = true;
    this.clearViewerLocation();
  },
  onUnload() { this._disposed = true; this._unloaded = true; this.clearViewerLocation(); },
  onReachBottom() { return this.loadMore(); },
  async onPullDownRefresh() {
    try { if (this._viewerLocation) await this.fetchNearby({ keepContent: true }); }
    finally { if (typeof wx.stopPullDownRefresh === 'function') wx.stopPullDownRefresh(); }
  },

  clearViewerLocation() { this._viewerLocation = null; this._requestSeq = (this._requestSeq || 0) + 1; },
  handleEnableLocation() {
    if (this.data.modal.visible || this._permissionCheckPending) return false;
    if (typeof wx.getSetting !== 'function') return this.locateAndLoad();
    this._permissionCheckPending = true;
    return new Promise((resolve) => {
      wx.getSetting({
        success: (result) => {
          if (this._disposed) return resolve(false);
          const permission = result && result.authSetting && result.authSetting['scope.userLocation'];
          if (permission === false) {
            this.setData({ state: 'denied', errorMessage: '未获取到定位权限' });
            this.openLocationModal();
            return resolve(false);
          }
          resolve(this.locateAndLoad());
        },
        fail: () => resolve(this._disposed ? false : this.locateAndLoad()),
        complete: () => { this._permissionCheckPending = false; }
      });
    });
  },
  openLocationModal() {
    if (this._disposed || this.data.modal.visible) return;
    this.setData({ modal: modalState({
      visible: true,
      type: 'location',
      title: '需要位置权限',
      description: '开启位置权限后，可以更方便地发现附近的拼局。',
      cancelText: '暂不开启',
      confirmText: '去授权',
      closeOnMask: true
    }) });
  },
  handleModalCancel() {
    if (this.data.modal.loading) return;
    this.setData({ modal: { ...this.data.modal, visible: false, loading: false } });
  },
  handleModalClose() { this.handleModalCancel(); },
  handleModalConfirm() {
    if (this.data.modal.loading || this._locationSettingsPending) return;
    this._locationSettingsPending = true;
    this.setData({ modal: { ...this.data.modal, loading: true } });
    wx.openSetting({
      success: (result) => {
        if (this._unloaded) return;
        const granted = Boolean(result && result.authSetting && result.authSetting['scope.userLocation']);
        if (this._disposed) {
          this._resumeLocationSettingResult = { granted };
          return;
        }
        this._locateAfterModal = granted;
        this.setData({
          modal: { ...this.data.modal, visible: false, loading: false },
          ...(!granted ? { state: 'denied', errorMessage: '仍未开启定位权限，可随时查看全城活动' } : {})
        });
      },
      fail: () => {
        if (this._unloaded) return;
        if (this._disposed) {
          this._resumeLocationSettingResult = { granted: false, errorMessage: '暂时无法打开设置，请稍后重试' };
          return;
        }
        this.setData({ modal: { ...this.data.modal, visible: false, loading: false }, state: 'denied', errorMessage: '暂时无法打开设置，请稍后重试' });
      },
      complete: () => { this._locationSettingsPending = false; }
    });
  },
  handleModalClosed() {
    const locate = this._locateAfterModal;
    this._locateAfterModal = false;
    if (this._disposed) return;
    this.setData({ modal: modalState() });
    if (locate) return this.locateAndLoad();
  },
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
          if (state === 'denied') this.openLocationModal();
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
  handleOpenSettings() { this.openLocationModal(); },
  handleAllActivities() { wx.redirectTo({ url: '/subpackages/activity/list/index' }); },
  handleCardSelect(event) { wx.navigateTo({ url: `/subpackages/activity/detail/index?id=${encodeURIComponent(event.detail.id)}` }); }
});
