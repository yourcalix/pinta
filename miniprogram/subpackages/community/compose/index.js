'use strict';

const communityService = require('../../../services/community');
const userService = require('../../../services/user');
const { calculateContentTopInset } = require('../../../utils/navigation-layout');

const CONTENT_LIMIT = 500;
const TOPIC_TAGS = new Set(['#寻找搭子', '#运动打卡', '#日常碎碎念']);

Page({
  data: {
    contentTopInset: 88,
    content: '',
    contentLength: 0,
    remaining: CONTENT_LIMIT,
    authorNickname: '拼吧用户',
    submitting: false,
    errorMessage: ''
  },

  onLoad() {
    this._disposed = false;
    this.setData({ contentTopInset: calculateContentTopInset(typeof wx === 'undefined' ? null : wx) });
    this.syncCachedAuthorProfile();
    this.loadAuthorProfile();
  },

  onUnload() {
    this._disposed = true;
    this._profileLoadSeq = (this._profileLoadSeq || 0) + 1;
    if (typeof wx !== 'undefined' && typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
  },

  syncCachedAuthorProfile() {
    const app = typeof getApp === 'function' ? getApp() : null;
    const profile = app && app.globalData && app.globalData.user && app.globalData.user.profile;
    return this.applyAuthorProfile(profile);
  },

  applyAuthorProfile(profile) {
    const nickname = String(profile && profile.nickname || '').trim();
    if (!nickname || nickname === this.data.authorNickname) return false;
    this.setData({ authorNickname: nickname });
    return true;
  },

  async loadAuthorProfile() {
    const seq = (this._profileLoadSeq = (this._profileLoadSeq || 0) + 1);
    try {
      const result = await userService.getProfile();
      if (this._disposed || seq !== this._profileLoadSeq) return;
      const profile = result && result.user && result.user.profile;
      this.applyAuthorProfile(profile);
    } catch (error) {
      // The compose flow has already authenticated the user. Keep the safe label if this optional read fails.
    }
  },

  handleCancel() {
    if (this.data.submitting) return;
    wx.navigateBack();
  },

  handleInput(event) {
    const content = String(event.detail.value || '').slice(0, CONTENT_LIMIT);
    this.setData({
      content,
      contentLength: content.length,
      remaining: CONTENT_LIMIT - content.length,
      errorMessage: ''
    });
  },

  handleTopicTap(event) {
    const topic = String(event.currentTarget.dataset.topic || '');
    if (!TOPIC_TAGS.has(topic)) return;
    if (this.data.content.includes(topic)) {
      wx.showToast({ title: '已添加该话题', icon: 'none' });
      return;
    }
    const separator = this.data.content && !/\s$/.test(this.data.content) ? ' ' : '';
    const nextContent = `${this.data.content}${separator}${topic} `;
    if (nextContent.length > CONTENT_LIMIT) {
      wx.showToast({ title: '字数已达上限', icon: 'none' });
      return;
    }
    this.setData({
      content: nextContent,
      contentLength: nextContent.length,
      remaining: CONTENT_LIMIT - nextContent.length,
      errorMessage: ''
    });
  },

  handleGuidelines() {
    if (typeof wx === 'undefined' || typeof wx.showModal !== 'function') return;
    if (typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
    wx.showModal({
      title: '拼吧社区守则',
      content: '请保持真实、友善与尊重，不要发布电话、微信号、二维码、外链、广告引流、骚扰或其他违法违规内容。',
      showCancel: false,
      confirmText: '我知道了',
      confirmColor: '#B86B00'
    });
  },

  async handleSubmit() {
    const content = this.data.content.trim();
    if (this.data.submitting) return;
    if (content.length < 2) return this.setData({ errorMessage: '请写下至少 2 个字的讨论内容' });
    this.setData({ submitting: true, errorMessage: '' });
    try {
      const result = await communityService.createPost(content);
      wx.redirectTo({ url: `/subpackages/community/detail/index?id=${encodeURIComponent(result.post.id)}` });
    } catch (error) {
      if (!this._disposed) this.setData({ errorMessage: error.handled ? '账号暂时无法使用' : error.message || '发起讨论失败，请重试' });
    } finally {
      if (!this._disposed) this.setData({ submitting: false });
    }
  }
});
