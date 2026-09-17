'use strict';

const amapService = require('../../../services/amap');

Page({
  data: {
    keyword: '', results: [], selected: null, markers: [],
    mapLatitude: 22.198745, mapLongitude: 113.543873,
    loading: false, searched: false, error: '', errorCode: '', canRetrySearch: false,
    showMapPreview: false
  },

  onUnload() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchSeq = (this._searchSeq || 0) + 1;
  },

  handleKeywordInput(event) {
    const keyword = event.detail.value;
    this._searchSeq = (this._searchSeq || 0) + 1;
    this.setData({ keyword, error: '', errorCode: '', canRetrySearch: false, showMapPreview: false });
    if (this._searchTimer) clearTimeout(this._searchTimer);
    if (!keyword.trim()) {
      this.setData({ results: [], searched: false, loading: false });
      return;
    }
    this._searchTimer = setTimeout(() => this.search(), 320);
  },

  handleSearch() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    return this.search();
  },

  async search() {
    const keyword = this.data.keyword.trim();
    if (!keyword) return false;
    const sequence = (this._searchSeq = (this._searchSeq || 0) + 1);
    this.setData({
      loading: true,
      searched: true,
      error: '',
      errorCode: '',
      canRetrySearch: false,
      showMapPreview: false
    });
    try {
      const results = await amapService.searchPoi(keyword);
      if (sequence !== this._searchSeq) return false;
      this.setData({ results, loading: false, error: '', errorCode: '', canRetrySearch: false });
      return true;
    } catch (error) {
      if (sequence !== this._searchSeq) return false;
      const errorCode = typeof error.code === 'string' ? error.code : 'AMAP_SEARCH_FAILED';
      const canRetrySearch = ['AMAP_NETWORK_FAILED', 'AMAP_REQUEST_FAILED', 'AMAP_RESPONSE_INVALID'].includes(errorCode);
      this.setData({
        results: [],
        loading: false,
        error: error.message || '地点搜索失败，请重试',
        errorCode,
        canRetrySearch
      });
      return false;
    }
  },

  handleRetrySearch() {
    if (!this.data.canRetrySearch || this.data.loading) return false;
    return this.search();
  },

  handleSelectPoi(event) {
    const index = Number(event.currentTarget.dataset.index);
    const selected = this.data.results[index];
    if (!selected) return false;
    this.setData({
      selected,
      showMapPreview: true,
      mapLatitude: selected.latitude,
      mapLongitude: selected.longitude,
      markers: [{ id: 1, latitude: selected.latitude, longitude: selected.longitude, title: selected.label }]
    });
    return true;
  },

  handleConfirm() {
    if (!this.data.selected) return false;
    let channel = null;
    try {
      channel = typeof this.getOpenerEventChannel === 'function' ? this.getOpenerEventChannel() : null;
      if (!channel || typeof channel.emit !== 'function') throw new Error('EVENT_CHANNEL_UNAVAILABLE');
      channel.emit('meetingPointSelected', this.data.selected);
    } catch (error) {
      const message = '地点回传失败，请重试';
      this.setData({ error: message });
      if (typeof wx.showToast === 'function') wx.showToast({ title: message, icon: 'none' });
      return false;
    }
    wx.navigateBack({ delta: 1 });
    return true;
  }
});
