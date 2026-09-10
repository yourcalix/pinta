'use strict';

const amapService = require('../../../services/amap');

Page({
  data: {
    keyword: '', results: [], selected: null, markers: [],
    mapLatitude: 22.198745, mapLongitude: 113.543873,
    loading: false, searched: false, error: '', showMapPreview: false
  },

  onUnload() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchSeq = (this._searchSeq || 0) + 1;
  },

  handleKeywordInput(event) {
    const keyword = event.detail.value;
    this._searchSeq = (this._searchSeq || 0) + 1;
    this.setData({ keyword, error: '', showMapPreview: false });
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
    this.setData({ loading: true, searched: true, error: '', showMapPreview: false });
    try {
      const results = await amapService.searchPoi(keyword);
      if (sequence !== this._searchSeq) return false;
      this.setData({ results, loading: false });
      return true;
    } catch (error) {
      if (sequence !== this._searchSeq) return false;
      this.setData({ results: [], loading: false, error: error.message || '地点搜索失败，请重试' });
      return false;
    }
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
    const channel = typeof this.getOpenerEventChannel === 'function' ? this.getOpenerEventChannel() : null;
    if (channel && typeof channel.emit === 'function') channel.emit('meetingPointSelected', this.data.selected);
    wx.navigateBack({ delta: 1 });
    return true;
  }
});
