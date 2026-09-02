'use strict';

const userService = require('../../../services/user');
const { PILOT_CITY } = require('../../../config/locations');

Page({
  data: {
    form: {
      nickname: '',
      gender: '',
      city: PILOT_CITY,
      interestsText: '',
      adultConfirmed: false
    },
    saving: false,
    genderError: false,
    errorMessage: ''
  },

  onLoad(options) {
    this.nextUrl = options.next ? decodeURIComponent(options.next) : '';
    this.loadProfile();
  },

  async loadProfile() {
    try {
      await userService.login();
      await userService.login();
      const result = await userService.getProfile();
      const profile = result.user && result.user.profile;
      if (profile) {
        this.setData({
          form: {
            nickname: profile.nickname || '',
            gender: profile.gender || '',
            city: profile.city || PILOT_CITY,
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

  handleGender(event) {
    const gender = event.currentTarget.dataset.gender;
    if (!['MALE', 'FEMALE'].includes(gender)) return;
    this.setData({ 'form.gender': gender, genderError: false, errorMessage: '' });
  },

  async handleSave() {
    if (this.data.saving) return;
    const form = this.data.form;
    if (form.nickname.trim().length < 2) return this.setData({ errorMessage: '昵称至少需要2个字' });
    if (!['MALE', 'FEMALE'].includes(form.gender)) return this.setData({ genderError: true, errorMessage: '请选择性别' });
    if (!form.adultConfirmed) return this.setData({ errorMessage: 'MVP 仅面向18岁及以上用户' });
    this.setData({ saving: true, errorMessage: '' });
    try {
      const result = await userService.updateProfile({
        nickname: form.nickname.trim(),
        gender: form.gender,
        city: PILOT_CITY,
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
