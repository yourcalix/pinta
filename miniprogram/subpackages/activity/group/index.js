'use strict';

const activityService = require('../../../services/activity');
const { decorateActivity } = require('../../../utils/display');

Page({
  data: {
    id: '',
    loading: true,
    error: '',
    activity: null,
    contact: null,
    revealing: false,
    pending: false
  },

  onLoad(options) {
    this.setData({ id: options.id || '' });
  },

  onShow() {
    if (this.data.id) this.loadDetail();
  },

  async loadDetail() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await activityService.detail(this.data.id);
      const activity = decorateActivity(result.activity);
      if (!['owner', 'member'].includes(activity.viewerRole)) {
        this.setData({ loading: false, error: '仅活动成员可以进入成团页' });
        return;
      }
      this.setData({ activity, loading: false });
    } catch (error) {
      this.setData({ loading: false, error: error.message || '成团信息加载失败' });
    }
  },

  handleReveal() {
    if (this.data.revealing || this.data.contact) return;
    wx.showModal({
      title: '查看联系信息前请确认',
      content: '拼吧不提供资金担保。不要向陌生人提前转账；线下见面请选择公共场所并告知亲友。',
      confirmText: '我已了解',
      success: async (result) => {
        if (!result.confirm) return;
        this.setData({ revealing: true });
        try {
          const contact = await activityService.contact(this.data.id);
          this.setData({ contact });
        } catch (error) {
          wx.showToast({ title: error.message || '暂时无法查看', icon: 'none' });
        } finally {
          this.setData({ revealing: false });
        }
      }
    });
  },

  handleCopy() {
    if (!this.data.contact) return;
    wx.setClipboardData({
      data: this.data.contact.contactInfo,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    });
  },

  handleComplete() {
    wx.showModal({
      title: '标记活动已完成？',
      content: '完成后活动进入历史记录，不再接受成员变更。',
      confirmText: '确认完成',
      success: async (result) => {
        if (!result.confirm) return;
        this.setData({ pending: true });
        try {
          await activityService.complete(this.data.id);
          wx.showToast({ title: '活动已完成', icon: 'success' });
          await this.loadDetail();
        } catch (error) {
          wx.showToast({ title: error.message || '操作失败', icon: 'none' });
        } finally {
          this.setData({ pending: false });
        }
      }
    });
  },

  handleLeave() {
    wx.showModal({
      title: '退出活动？',
      content: '退出后名额会释放，联系方式也将无法继续查看。请尽早告知发起者。',
      confirmText: '确认退出',
      confirmColor: '#E5484D',
      success: async (result) => {
        if (!result.confirm) return;
        this.setData({ pending: true });
        try {
          await activityService.leave(this.data.id, '参与者计划变化，主动退出活动');
          wx.showToast({ title: '已退出活动', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 400);
        } catch (error) {
          wx.showToast({ title: error.message || '退出失败', icon: 'none' });
        } finally {
          this.setData({ pending: false });
        }
      }
    });
  },

  handleReport() {
    wx.navigateTo({ url: `/subpackages/safety/report/index?type=activity&id=${this.data.id}` });
  }
});
