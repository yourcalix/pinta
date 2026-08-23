'use strict';

const userService = require('../../../services/user');
const safetyService = require('../../../services/safety');

Page({
  data: {
    targetType: 'activity',
    targetId: '',
    reasons: [
      { value: 'FALSE_INFORMATION', label: '虚假或误导信息', description: '时间、地点、商品或活动信息明显不实' },
      { value: 'ILLEGAL_RIDE_CHARGE', label: '涉嫌收费载客', description: '以司机身份报价、招揽乘客或变相营运' },
      { value: 'FRAUD_OR_DIVERSION', label: '诈骗或导流', description: '要求提前转账、收定金或诱导到不明平台' },
      { value: 'HARASSMENT', label: '骚扰或不当社交', description: '语言骚扰、婚恋暗示或与活动无关的接触' },
      { value: 'OTHER', label: '其他问题', description: '不属于以上类型的安全问题' }
    ],
    reason: '',
    description: '',
    submitting: false,
    errorMessage: ''
  },

  onLoad(options) {
    this.setData({ targetType: options.type || 'activity', targetId: options.id || '' });
  },

  handleReason(event) {
    this.setData({ reason: event.detail.value, errorMessage: '' });
  },

  handleDescription(event) {
    this.setData({ description: event.detail.value, errorMessage: '' });
  },

  async handleSubmit() {
    if (this.data.submitting) return;
    if (!this.data.reason) return this.setData({ errorMessage: '请选择举报原因' });
    this.setData({ submitting: true, errorMessage: '' });
    try {
      const user = await userService.login();
      if (!user.profile || !user.profile.adultConfirmed) {
        wx.navigateTo({ url: '/subpackages/profile/edit/index' });
        return;
      }
      await safetyService.report({
        targetType: this.data.targetType,
        targetId: this.data.targetId,
        reason: this.data.reason,
        description: this.data.description.trim()
      });
      wx.showModal({
        title: '举报已提交',
        content: '该活动会立即从你的发现列表隐藏。运营人员将在后台继续处理。',
        showCancel: false,
        confirmText: '知道了',
        success: () => wx.switchTab({ url: '/pages/discover/index' })
      });
    } catch (error) {
      this.setData({
        errorMessage: error.handled ? '账号暂时无法使用' : error.message || '提交失败，请重试'
      });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
