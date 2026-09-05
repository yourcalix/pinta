'use strict';

const userService = require('../../../services/user');
const { PILOT_CITY } = require('../../../config/locations');
const { calculateContentTopInset } = require('../../../utils/navigation-layout');
const { profileAvatarPath } = require('../../../utils/passenger-avatar');
const { resolveProfileAvatar } = require('../../../utils/profile-avatar');
const {
  DEFAULT_PROFILE_COVER,
  DEFAULT_PROFILE_COVER_PATH,
  PROFILE_COVER_OPTIONS,
  readProfileCover,
  writeProfileCover,
  resolveProfileCover
} = require('../../../utils/profile-cover');
const {
  buildBirthDatePicker,
  updateBirthDatePicker
} = require('../../../utils/profile-birth-date');

const GENDER_OPTIONS = Object.freeze([
  { label: '男', value: 'MALE' },
  { label: '女', value: 'FEMALE' }
]);

const NICKNAME_MIN_LENGTH = 2;
const NICKNAME_MAX_LENGTH = 20;

function nicknameDraftState(value) {
  const draft = String(value || '');
  const nickname = draft.trim();
  const length = nickname.length;
  const valid = length >= NICKNAME_MIN_LENGTH && length <= NICKNAME_MAX_LENGTH;
  return {
    draft,
    nickname,
    valid,
    error: valid ? '' : '昵称需为 2—20 个字',
    hint: valid ? `${length}/${NICKNAME_MAX_LENGTH}` : '昵称需为 2—20 个字'
  };
}

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
    avatarFallbackPath: profileAvatarPath(null),
    hasCustomAvatar: false,
    customAvatarLoadFailed: false,
    avatarUploading: false,
    avatarUploadError: '',
    currentCoverType: DEFAULT_PROFILE_COVER,
    currentCoverLabel: PROFILE_COVER_OPTIONS[0].label,
    currentCoverPath: DEFAULT_PROFILE_COVER_PATH,
    genderOptions: GENDER_OPTIONS,
    genderIndex: 0,
    genderLabel: '请选择',
    nicknameSheetMounted: false,
    nicknameSheetOpen: false,
    nicknameDraft: '',
    nicknameInputFocus: false,
    nicknameCanConfirm: false,
    nicknameError: '',
    nicknameHint: '',
    birthdaySheetMounted: false,
    birthdaySheetOpen: false,
    birthdayPicking: false,
    birthdayYears: [],
    birthdayMonths: [],
    birthdayDays: [],
    birthdayPickerValue: [0, 0, 0],
    birthdayDraft: '',
    birthdayIndicatorStyle: 'height: 88rpx; border-top: 2rpx solid rgba(22, 163, 106, 0.45); border-bottom: 2rpx solid rgba(22, 163, 106, 0.45);',
    form: {
      nickname: '',
      gender: '',
      birthDate: '',
      city: PILOT_CITY,
      interestsText: '',
      adultConfirmed: false
    },
    saving: false,
    genderError: false,
    errorMessage: ''
  },

  onLoad(options) {
    this._disposed = false;
    this.nextUrl = options.next ? decodeURIComponent(options.next) : '';
    const cover = resolveProfileCover(readProfileCover(wx), this.data.profileAvatarPath);
    let windowWidth = 375;
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      windowWidth = Number(info.windowWidth) || windowWidth;
    } catch (error) {}
    const indicatorHeight = windowWidth <= 340 ? 80 : 88;
    this.setData({
      contentTopInset: calculateContentTopInset(wx),
      birthdayIndicatorStyle: `height: ${indicatorHeight}rpx; border-top: 2rpx solid rgba(22, 163, 106, 0.45); border-bottom: 2rpx solid rgba(22, 163, 106, 0.45);`,
      currentCoverType: cover.key,
      currentCoverLabel: cover.label,
      currentCoverPath: cover.path
    });
    this.loadProfile();
  },

  onHide() {
    this.dismissNicknameSheetImmediately();
    this.dismissBirthdaySheetImmediately();
  },

  onUnload() {
    this._disposed = true;
    this.clearNicknameTimers();
    this.clearBirthdayTimers();
    if (typeof wx !== 'undefined' && typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
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
      const avatar = resolveProfileAvatar(profile);
      const cover = resolveProfileCover(readProfileCover(wx), avatar.path);
      this.setData({
        loading: false,
        profileAvatarPath: avatar.path,
        avatarFallbackPath: avatar.fallbackPath,
        hasCustomAvatar: avatar.custom,
        customAvatarLoadFailed: false,
        currentCoverType: cover.key,
        currentCoverLabel: cover.label,
        currentCoverPath: cover.path,
        genderIndex: genderIndex(gender),
        genderLabel: genderLabel(gender),
        form: {
          nickname: profile.nickname || '',
          gender,
          birthDate: profile.birthDate || '',
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

  clearNicknameTimers() {
    clearTimeout(this._nicknameOpenTimer);
    clearTimeout(this._nicknameFocusTimer);
    clearTimeout(this._nicknameCloseTimer);
    this._nicknameOpenTimer = null;
    this._nicknameFocusTimer = null;
    this._nicknameCloseTimer = null;
  },

  handleNicknameOpen() {
    if (this.data.loading || this.data.saving || (this.data.nicknameSheetMounted && this.data.nicknameSheetOpen)) return;
    this.clearNicknameTimers();
    const state = nicknameDraftState(this.data.form.nickname);
    this.setData({
      nicknameSheetMounted: true,
      nicknameSheetOpen: false,
      nicknameDraft: state.draft,
      nicknameInputFocus: false,
      nicknameCanConfirm: state.valid,
      nicknameError: '',
      nicknameHint: state.valid ? state.hint : ''
    });
    this._nicknameOpenTimer = setTimeout(() => {
      if (this.data.nicknameSheetMounted) this.setData({ nicknameSheetOpen: true });
    }, 16);
    this._nicknameFocusTimer = setTimeout(() => {
      if (this.data.nicknameSheetMounted && this.data.nicknameSheetOpen) this.setData({ nicknameInputFocus: true });
    }, 180);
  },

  handleNicknameDraftInput(event) {
    const state = nicknameDraftState(event.detail.value);
    this.setData({
      nicknameDraft: state.draft,
      nicknameCanConfirm: state.valid,
      nicknameError: state.error,
      nicknameHint: state.hint
    });
  },

  handleNicknameConfirm() {
    if (!this.data.nicknameSheetMounted) return;
    const state = nicknameDraftState(this.data.nicknameDraft);
    if (!state.valid) {
      this.setData({
        nicknameCanConfirm: false,
        nicknameError: state.error,
        nicknameHint: state.hint
      });
      return;
    }
    this.setData({ 'form.nickname': state.nickname, errorMessage: '' });
    this.handleNicknameClose();
  },

  handleNicknameClose() {
    if (!this.data.nicknameSheetMounted) return;
    this.clearNicknameTimers();
    if (typeof wx !== 'undefined' && typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
    this.setData({ nicknameSheetOpen: false, nicknameInputFocus: false });
    this._nicknameCloseTimer = setTimeout(() => {
      if (this.data.nicknameSheetOpen) return;
      this.setData({
        nicknameSheetMounted: false,
        nicknameDraft: '',
        nicknameCanConfirm: false,
        nicknameError: '',
        nicknameHint: ''
      });
    }, 200);
  },

  dismissNicknameSheetImmediately() {
    this.clearNicknameTimers();
    if (!this.data.nicknameSheetMounted) return;
    if (typeof wx !== 'undefined' && typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
    this.setData({
      nicknameSheetMounted: false,
      nicknameSheetOpen: false,
      nicknameDraft: '',
      nicknameInputFocus: false,
      nicknameCanConfirm: false,
      nicknameError: '',
      nicknameHint: ''
    });
  },

  clearBirthdayTimers() {
    clearTimeout(this._birthdayOpenTimer);
    clearTimeout(this._birthdayCloseTimer);
    this._birthdayOpenTimer = null;
    this._birthdayCloseTimer = null;
  },

  handleBirthdayOpen() {
    if (this.data.loading || this.data.saving || (this.data.birthdaySheetMounted && this.data.birthdaySheetOpen)) return;
    this.dismissNicknameSheetImmediately();
    this.clearBirthdayTimers();
    const picker = buildBirthDatePicker(this.data.form.birthDate);
    this._birthdayPickerState = picker;
    this.setData({
      birthdaySheetMounted: true,
      birthdaySheetOpen: false,
      birthdayPicking: false,
      birthdayYears: picker.years,
      birthdayMonths: picker.months,
      birthdayDays: picker.days,
      birthdayPickerValue: picker.pickerValue,
      birthdayDraft: picker.draft
    });
    this._birthdayOpenTimer = setTimeout(() => {
      if (this.data.birthdaySheetMounted) this.setData({ birthdaySheetOpen: true });
    }, 16);
  },

  handleBirthdayChange(event) {
    if (!this._birthdayPickerState) return;
    const picker = updateBirthDatePicker(this._birthdayPickerState, event.detail.value || []);
    this._birthdayPickerState = picker;
    this.setData({
      birthdayYears: picker.years,
      birthdayMonths: picker.months,
      birthdayDays: picker.days,
      birthdayPickerValue: picker.pickerValue,
      birthdayDraft: picker.draft
    });
  },

  handleBirthdayPickStart() {
    this.setData({ birthdayPicking: true });
  },

  handleBirthdayPickEnd() {
    this.setData({ birthdayPicking: false });
  },

  handleBirthdayConfirm() {
    if (!this.data.birthdaySheetMounted || this.data.birthdayPicking || !this.data.birthdayDraft) return;
    this.setData({
      'form.birthDate': this.data.birthdayDraft,
      'form.adultConfirmed': true,
      errorMessage: ''
    });
    this.handleBirthdayClose();
  },

  handleBirthdayClose() {
    if (!this.data.birthdaySheetMounted) return;
    this.clearBirthdayTimers();
    this.setData({ birthdaySheetOpen: false, birthdayPicking: false });
    this._birthdayCloseTimer = setTimeout(() => {
      if (this.data.birthdaySheetOpen) return;
      this._birthdayPickerState = null;
      this.setData({
        birthdaySheetMounted: false,
        birthdayYears: [],
        birthdayMonths: [],
        birthdayDays: [],
        birthdayPickerValue: [0, 0, 0],
        birthdayDraft: ''
      });
    }, 200);
  },

  dismissBirthdaySheetImmediately() {
    this.clearBirthdayTimers();
    this._birthdayPickerState = null;
    if (!this.data.birthdaySheetMounted) return;
    this.setData({
      birthdaySheetMounted: false,
      birthdaySheetOpen: false,
      birthdayPicking: false,
      birthdayYears: [],
      birthdayMonths: [],
      birthdayDays: [],
      birthdayPickerValue: [0, 0, 0],
      birthdayDraft: ''
    });
  },

  preventScroll() {},

  handleGenderPick(event) {
    const index = Number(event.detail.value);
    const option = GENDER_OPTIONS[index];
    if (!option) return;
    const gender = option.value;
    const fallbackPath = profileAvatarPath(gender);
    const avatarPath = this.data.hasCustomAvatar && !this.data.customAvatarLoadFailed ? this.data.profileAvatarPath : fallbackPath;
    const cover = resolveProfileCover(this.data.currentCoverType, avatarPath);
    this.setData({
      'form.gender': gender,
      genderIndex: index,
      genderLabel: option.label,
      profileAvatarPath: avatarPath,
      avatarFallbackPath: fallbackPath,
      currentCoverPath: cover.path,
      genderError: false,
      errorMessage: ''
    });
  },

  async handleChooseAvatar(event) {
    const filePath = event.detail && event.detail.avatarUrl;
    if (!filePath || this.data.avatarUploading) return;
    const previousPath = this.data.profileAvatarPath;
    this.setData({ profileAvatarPath: filePath, customAvatarLoadFailed: false, avatarUploading: true, avatarUploadError: '' });
    try {
      const result = await userService.uploadAvatar(filePath);
      if (this._disposed) return;
      const profile = result.user && result.user.profile;
      const avatar = resolveProfileAvatar(profile);
      const cover = resolveProfileCover(this.data.currentCoverType, avatar.path);
      getApp().globalData.user = result.user;
      this.setData({
        profileAvatarPath: avatar.path,
        avatarFallbackPath: avatar.fallbackPath,
        hasCustomAvatar: avatar.custom,
        customAvatarLoadFailed: false,
        avatarUploading: false,
        currentCoverPath: cover.path
      });
      wx.showToast({ title: '头像已更换', icon: 'success' });
    } catch (error) {
      if (this._disposed) return;
      this.setData({ profileAvatarPath: previousPath, customAvatarLoadFailed: false, avatarUploading: false, avatarUploadError: error.handled ? '账号暂时无法使用' : error.message || '上传失败，点击重试' });
      wx.showToast({ title: '头像上传失败，请重试', icon: 'none' });
    }
  },

  handleAvatarImageError() {
    if (this.data.profileAvatarPath === this.data.avatarFallbackPath) return;
    this.setData({ profileAvatarPath: this.data.avatarFallbackPath, customAvatarLoadFailed: true, avatarUploadError: '头像加载失败，点击重新选择' });
  },

  async handleRestoreAvatar() {
    if (!this.data.hasCustomAvatar || this.data.avatarUploading) return;
    this.setData({ avatarUploading: true, avatarUploadError: '' });
    try {
      const result = await userService.clearAvatar();
      if (this._disposed) return;
      const avatar = resolveProfileAvatar(result.user && result.user.profile);
      const cover = resolveProfileCover(this.data.currentCoverType, avatar.path);
      getApp().globalData.user = result.user;
      this.setData({ profileAvatarPath: avatar.path, avatarFallbackPath: avatar.fallbackPath, hasCustomAvatar: false, customAvatarLoadFailed: false, avatarUploading: false, currentCoverPath: cover.path });
      wx.showToast({ title: '已恢复默认头像', icon: 'success' });
    } catch (error) {
      if (this._disposed) return;
      this.setData({ avatarUploading: false, avatarUploadError: error.handled ? '账号暂时无法使用' : error.message || '恢复失败，请重试' });
    }
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
    if (!form.adultConfirmed) return this.setData({ errorMessage: '请选择生日完成年龄核验' });
    this.setData({ saving: true, errorMessage: '' });
    try {
      const profileInput = {
        nickname: form.nickname.trim(),
        gender: form.gender,
        city: PILOT_CITY,
        interests: form.interestsText.split(/[、,，\s]+/).map((item) => item.trim()).filter(Boolean).slice(0, 8),
        adultConfirmed: true
      };
      if (form.birthDate) profileInput.birthDate = form.birthDate;
      const result = await userService.updateProfile(profileInput);
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
