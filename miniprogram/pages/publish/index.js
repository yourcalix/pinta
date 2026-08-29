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
  }
});
