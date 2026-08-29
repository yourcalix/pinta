'use strict';

const activityService = require('../../../services/activity');
const { clipboardFailureMessage } = require('../../../services/privacy');
const { decorateActivity } = require('../../../utils/display');
const { buildActivityPath, decodeActivityId } = require('../../../utils/activity-route');
const { resolveProtectedPageError } = require('../../../utils/protected-page-error');

Page({
  data: {
    id: '',
    loading: true,
    error: '',
    errorCode: '',
    errorAction: '',
    errorActionText: '',
    activity: null,
    contact: null,
    revealing: false,
    copying: false,
    pending: false
  },

  onLoad(options = {}) {
    this.setData({ id: decodeActivityId(options.id) });
  },

  onShow() {
    return this.loadDetail();
  },

  onUnload() {
    this._loadSeq = (this._loadSeq || 0) + 1;
  },

  async loadDetail() {
    const loadSeq = (this._loadSeq = (this._loadSeq || 0) + 1);
    if (!this.data.id) {
      this.setData({
        loading: false,
        activity: null,
        contact: null,
        ...resolveProtectedPageError({ code: 'NOT_FOUND' }, 'group')
      });
      return;
    }
    this.setData({
      loading: true,
      error: '',
      errorCode: '',
      errorAction: '',
      errorActionText: '',
      activity: null
    });
    try {
      const result = await activityService.detail(this.data.id);
      if (loadSeq !== this._loadSeq) return;
      const activity = decorateActivity(result.activity);
      if (!['owner', 'member'].includes(activity.viewerRole)) {
        this.setData({
          loading: false,
          activity: null,
          contact: null,
          ...resolveProtectedPageError({ code: 'FORBIDDEN' }, 'group')
        });
        return;
      }
      if (!['FORMED', 'IN_PROGRESS', 'COMPLETED'].includes(activity.status)) {
        this.setData({
          loading: false,
          activity: null,
          contact: null,
          ...resolveProtectedPageError({ code: 'CONFLICT' }, 'group')
        });
        return;
      }
      this.setData({ activity, loading: false });
    } catch (error) {
      if (loadSeq !== this._loadSeq) return;
      this.setData({
        loading: false,
        activity: null,
        contact: null,
        ...resolveProtectedPageError(error, 'group')
      });
    }
  },

  handleErrorAction() {
    if (this.data.errorAction === 'RETRY') {
      this.loadDetail();
      return;
    }
    if (this.data.errorAction === 'DETAIL') {
      wx.redirectTo({ url: buildActivityPath('DETAIL', this.data.id) });
      return;
    }
    wx.switchTab({ url: '/pages/discover/index' });
  },

  handleReveal() {
    if (this.data.revealing || this.data.contact || (this.data.activity && this.data.activity.type === 'ride')) return;
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
          if (!error.handled) wx.showToast({ title: error.message || '暂时无法查看', icon: 'none' });
        } finally {
          this.setData({ revealing: false });
        }
      }
    });
  },

  handleCopy() {
    if (!this.data.contact || this.data.copying) return;
    if (typeof wx.setClipboardData !== 'function') {
      wx.showToast({ title: '当前微信版本不支持一键复制，可长按文本手动复制', icon: 'none' });
      return;
    }
    this.setData({ copying: true });
    try {
      wx.setClipboardData({
        data: this.data.contact.contactInfo,
        fail: (error) => wx.showToast({ title: clipboardFailureMessage(error), icon: 'none' }),
        complete: () => this.setData({ copying: false })
      });
    } catch (error) {
      this.setData({ copying: false });
      wx.showToast({ title: clipboardFailureMessage(error), icon: 'none' });
    }
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
          if (!error.handled) wx.showToast({ title: error.message || '操作失败', icon: 'none' });
        } finally {
          this.setData({ pending: false });
        }
      }
    });
  },

  handleLeave() {
    wx.showModal({
      title: this.data.activity && this.data.activity.type === 'ride' ? '退出拼车？' : '退出活动？',
      content: '退出后名额会释放，联系方式也将无法继续查看。',
      confirmText: '确认退出',
      confirmColor: '#E5484D',
      success: async (result) => {
        if (!result.confirm) return;
        this.setData({ pending: true });
        try {
          await activityService.leave(this.data.id, '参与者计划变化，主动退出活动');
          wx.showToast({ title: this.data.activity.type === 'ride' ? '已退出拼车' : '已退出活动', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 400);
        } catch (error) {
          if (error.code === 'RIDE_MEMBER_LOCKED') {
            wx.showModal({ title: '暂不可退出', content: error.message, showCancel: false, complete: () => this.loadDetail() });
          } else if (!error.handled) wx.showToast({ title: error.message || '退出失败', icon: 'none' });
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
