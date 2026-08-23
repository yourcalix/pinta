'use strict';

const userService = require('../../services/user');

Page({
  data: {
    types: [
      { value: 'ride', icon: '↗', title: '拼车', description: '找同路线伙伴，共同预约合规交通方式', color: '#3478F6' },
      { value: 'product', icon: '□', title: '拼商品', description: '找邻里凑数量，到货后当面验货交付', color: '#F59E0B' },
      { value: 'buddy', icon: '○', title: '拼搭子', description: '围绕具体活动组队，不做婚恋社交', color: '#7C5CFC' }
    ],
    pending: false
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
      wx.navigateTo({ url: `/subpackages/publish/form/index?type=${type}` });
    } catch (error) {
      wx.showToast({ title: error.message || '暂时无法登录', icon: 'none' });
    } finally {
      this.setData({ pending: false });
    }
  }
});
