'use strict';

const userService = require('../../../services/user');

Page({
  data: {
    form: {
      nickname: '',
      city: '上海',
      interestsText: '',
      adultConfirmed: false
    },
    saving: false,
    errorMessage: ''
  },

  onLoad(options) {
    this.nextUrl = options.next ? decodeURIComponent(options.next) : '';
    this.loadProfile();
  },

  async loadProfile() {
    try {
      await userService.login();
      const result = await userService.getProfile();
      const profile = result.user && result.user.profile;
      if (profile) {
        this.setData({
          form: {
            nickname: profile.nickname || '',
            city: profile.city || '上海',
            interestsText: (profile.interests || []).join('、'),
            adultConfirmed: profile.adultConfirmed === true
          }
        });
      }
    } catch (error) {
      this.setData({ errorMessage: error.handled ? '账号暂时无法使用' : error.message || '资料加载失败' });
    }
  },

  handleInput(event) {
    this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value, errorMessage: '' });
  },

  handleAdult(event) {
    this.setData({ 'form.adultConfirmed': event.detail.value.includes('adult') });
  },

  async handleSave() {
    if (this.data.saving) return;
    const form = this.data.form;
    if (form.nickname.trim().length < 2) return this.setData({ errorMessage: '昵称至少需要2个字' });
    if (!form.adultConfirmed) return this.setData({ errorMessage: 'MVP 仅面向18岁及以上用户' });
    this.setData({ saving: true, errorMessage: '' });
    try {
      const result = await userService.updateProfile({
        nickname: form.nickname.trim(),
        city: form.city.trim() || '上海',
        interests: form.interestsText.split(/[、,，\s]+/).map((item) => item.trim()).filter(Boolean).slice(0, 8),
        adultConfirmed: true
      });
      getApp().globalData.user = result.user;
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => {
        if (this.nextUrl) wx.redirectTo({ url: this.nextUrl });
        else wx.navigateBack();
      }, 350);
    } catch (error) {
      this.setData({
        saving: false,
        errorMessage: error.handled ? '账号暂时无法使用' : error.message || '保存失败，请重试'
      });
    }
  }
});
