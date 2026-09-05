'use strict';

const userService = require('../../../services/user');
const { PILOT_CITY } = require('../../../config/locations');
const { calculateContentTopInset } = require('../../../utils/navigation-layout');
const { profileAvatarPath } = require('../../../utils/passenger-avatar');
const {
  DEFAULT_PROFILE_COVER,
  DEFAULT_PROFILE_COVER_PATH,
  PROFILE_COVER_OPTIONS,
  readProfileCover,
  writeProfileCover,
  resolveProfileCover
} = require('../../../utils/profile-cover');

const GENDER_OPTIONS = Object.freeze([
  { label: '男', value: 'MALE' },
  { label: '女', value: 'FEMALE' }
]);

function genderIndex(gender) {
  return Math.max(0, GENDER_OPTIONS.findIndex((item) => item.value === gender));
}

function genderLabel(gender) {
  const option = GENDER_OPTIONS.find((item) => item.value === gender);
  return option ? option.label : '请选择';
}

Page({
  data: {
    contentTopInset: 88,
    loading: true,
    profileAvatarPath: profileAvatarPath(null),
    currentCoverType: DEFAULT_PROFILE_COVER,
    currentCoverLabel: PROFILE_COVER_OPTIONS[0].label,
    currentCoverPath: DEFAULT_PROFILE_COVER_PATH,
    genderOptions: GENDER_OPTIONS,
    genderIndex: 0,
    genderLabel: '请选择',
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
    const cover = resolveProfileCover(readProfileCover(wx), this.data.profileAvatarPath);
    this.setData({
      contentTopInset: calculateContentTopInset(wx),
      currentCoverType: cover.key,
      currentCoverLabel: cover.label,
      currentCoverPath: cover.path
    });
    this.loadProfile();
  },

  async loadProfile() {
    try {
      await userService.login();
      const result = await userService.getProfile();
      const profile = result.user && result.user.profile;
      if (!profile) {
        this.setData({ loading: false });
        return;
      }
      const gender = profile.gender || '';
      const avatarPath = profileAvatarPath(gender);
      const cover = resolveProfileCover(readProfileCover(wx), avatarPath);
      this.setData({
        loading: false,
        profileAvatarPath: avatarPath,
        currentCoverType: cover.key,
        currentCoverLabel: cover.label,
        currentCoverPath: cover.path,
        genderIndex: genderIndex(gender),
        genderLabel: genderLabel(gender),
        form: {
          nickname: profile.nickname || '',
          gender,
          city: profile.city || PILOT_CITY,
          interestsText: (profile.interests || []).join('、'),
          adultConfirmed: profile.adultConfirmed === true
        }
      });
    } catch (error) {
      this.setData({
        loading: false,
        errorMessage: error.handled ? '账号暂时无法使用' : error.message || '资料加载失败'
      });
    }
  },

  handleBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    wx.switchTab({ url: '/pages/user/index' });
  },

  handleInput(event) {
    this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value, errorMessage: '' });
  },

  handleAdultConfirm() {
    if (this.data.form.adultConfirmed) return;
    this.setData({ 'form.adultConfirmed': true, errorMessage: '' });
  },

  handleGenderPick(event) {
    const index = Number(event.detail.value);
    const option = GENDER_OPTIONS[index];
    if (!option) return;
    const gender = option.value;
    const avatarPath = profileAvatarPath(gender);
    const cover = resolveProfileCover(this.data.currentCoverType, avatarPath);
    this.setData({
      'form.gender': gender,
      genderIndex: index,
      genderLabel: option.label,
      profileAvatarPath: avatarPath,
      currentCoverPath: cover.path,
      genderError: false,
      errorMessage: ''
    });
  },

  handleSelectCover() {
    if (this._coverPickerOpen) return;
    this._coverPickerOpen = true;
    wx.showActionSheet({
      itemList: PROFILE_COVER_OPTIONS.map((option) => option.label),
      success: (result) => {
        const option = PROFILE_COVER_OPTIONS[result.tapIndex];
        if (!option) return;
        if (!writeProfileCover(wx, option.key)) {
          wx.showToast({ title: '背景保存失败，请重试', icon: 'none' });
          return;
        }
        const cover = resolveProfileCover(option.key, this.data.profileAvatarPath);
        this.setData({
          currentCoverType: cover.key,
          currentCoverLabel: cover.label,
          currentCoverPath: cover.path
        });
        wx.showToast({ title: '背景已更新', icon: 'success', duration: 1500 });
      },
      fail: (error) => {
        if (!String(error && error.errMsg || '').includes('cancel')) {
          wx.showToast({ title: '背景选择失败，请重试', icon: 'none' });
        }
      },
      complete: () => { this._coverPickerOpen = false; }
    });
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
