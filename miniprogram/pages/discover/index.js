'use strict';

const activityService = require('../../services/activity');
const safetyService = require('../../services/safety');
const config = require('../../config/index');
const { decorateActivity } = require('../../utils/display');

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
    activities: [],
    loading: true,
    error: ''
  },

  onLoad() {
    this.loadActivities();
  },

  async onPullDownRefresh() {
    await this.loadActivities();
    wx.stopPullDownRefresh();
  },

  async loadActivities() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await activityService.list({
        city: this.data.city,
        type: this.data.currentType || undefined,
        keyword: this.data.keyword || undefined,
        limit: 30
      });
      this.setData({ activities: safetyService.filterHiddenActivities(result.items).map(decorateActivity), loading: false });
    } catch (error) {
      this.setData({ loading: false, error: error.message || '加载失败，请重试' });
    }
  },

  handleTypeChange(event) {
    this.setData({ currentType: event.currentTarget.dataset.value || '' });
    this.loadActivities();
  },

  handleKeywordInput(event) {
    this.setData({ keyword: event.detail.value });
  },

  handleSearch() {
    this.loadActivities();
  },

  handleCardSelect(event) {
    wx.navigateTo({ url: `/subpackages/activity/detail/index?id=${event.detail.id}` });
  },

  handleEmptyAction() {
    if (this.data.error) return this.loadActivities();
    wx.switchTab({ url: '/pages/publish/index' });
  }
});
