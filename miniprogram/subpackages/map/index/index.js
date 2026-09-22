'use strict';

const { calculateContentTopInset } = require('../../../utils/navigation-layout');

const ACTIVITY_TYPES = Object.freeze(['companion', 'sport', 'food', 'benefit']);

Page({
  data: {
    contentTopInset: 88
  },

  onLoad() {
    this._disposed = false;
    this._navigationPending = false;
    this._backPending = false;
    this.setData({
      contentTopInset: calculateContentTopInset(typeof wx === 'undefined' ? null : wx)
    });
  },

  onShow() {
    this._navigationPending = false;
    this._backPending = false;
  },

  onHide() {
    this._navigationPending = false;
    this._backPending = false;
  },

  onUnload() {
    this._disposed = true;
    this._navigationPending = false;
    this._backPending = false;
  },

  handleTypeSelect(event) {
    const type = String(event.currentTarget.dataset.type || '').trim();
    if (!ACTIVITY_TYPES.includes(type) || this._navigationPending || this._disposed) return false;
    this._navigationPending = true;
    wx.navigateTo({
      url: `/subpackages/activity/list/index?type=${encodeURIComponent(type)}`,
      fail: () => {
        this._navigationPending = false;
        if (typeof wx.showToast === 'function') {
          wx.showToast({ title: '页面打开失败，请稍后重试', icon: 'none' });
        }
      }
    });
    return true;
  },

  handleBack() {
    if (this._backPending || this._disposed) return false;
    this._backPending = true;
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    if (pages.length > 1 && typeof wx.navigateBack === 'function') {
      wx.navigateBack({ fail: () => { this._backPending = false; } });
      return true;
    }
    if (typeof wx.switchTab === 'function') {
      wx.switchTab({
        url: '/pages/discover/index',
        fail: () => { this._backPending = false; }
      });
      return true;
    }
    this._backPending = false;
    return false;
  }
});
