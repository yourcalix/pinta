'use strict';

const userService = require('../../services/user');
const { calculateContentTopInset } = require('../../utils/navigation-layout');

function promptGenderProfile(nextUrl) {
  wx.showModal({
    title: '请先完善性别资料',
    content: '发布或加入拼车前需要选择性别，成员头像会按性别自动显示。',
    confirmText: '去设置',
    success: (result) => {
      if (result.confirm) wx.navigateTo({ url: `/subpackages/profile/edit/index?next=${encodeURIComponent(nextUrl)}` });
    }
  });
}

Page({
  data: {
    contentTopInset: 88,
    types: [
      { value: 'ride', title: '发起校园拼车', description: '在 8 条澳门固定路线中发起行程，邀请同路同学加入' }
    ],
    pending: false
  },

  onLoad() {
    this.setData({
      contentTopInset: calculateContentTopInset(typeof wx === 'undefined' ? null : wx)
    });
  },

  async handleSelect(event) {
    if (this.data.pending) return;
    const type = event.currentTarget.dataset.type;
    this.setData({ pending: true });
    try {
      const user = await userService.login();
      if (!user.profile || !user.profile.adultConfirmed) {
        wx.navigateTo({ url: `/subpackages/profile/edit/index?next=${encodeURIComponent(`/subpackages/publish/form/index?type=${type}`)}` });
        return;
      }
      if (!['MALE', 'FEMALE'].includes(user.profile.gender)) {
        promptGenderProfile(`/subpackages/publish/form/index?type=${type}`);
        return;
      }
      wx.navigateTo({ url: `/subpackages/publish/form/index?type=${type}` });
    } catch (error) {
      if (!error.handled) wx.showToast({ title: error.message || '暂时无法登录', icon: 'none' });
    } finally {
      this.setData({ pending: false });
    }
  },

  handleSafetyNotice() {
    wx.showModal({
      title: '校园公益合乘安全边界',
      content: '拼吧仅提供澳门校园行程信息撮合，不提供车辆、在线收款或交通服务。请确认同行身份、保持通讯畅通并根据实际情况谨慎出行。司机承接功能仅向已完成合规审核的账号开放。',
      showCancel: false,
      confirmText: '我知道了'
    });
  }
});
