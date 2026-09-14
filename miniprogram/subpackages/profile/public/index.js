'use strict';

const publicProfileService = require('./service');
const ephemeralProfileNavigation = require('../../../services/ephemeral-profile-navigation');
const { calculateContentTopInset } = require('../../../utils/navigation-layout');
const { avatarPathFromKind, profileAvatarPath } = require('../../../utils/passenger-avatar');

function publicView(profile) {
  const gender = profile && profile.gender;
  const age = Number(profile && profile.age);
  const facts = [];
  if (Number.isInteger(age) && age >= 18 && age <= 150) facts.push(`${age}岁`);
  if (gender === 'FEMALE') facts.push('女生');
  if (gender === 'MALE') facts.push('男生');
  if (profile && profile.mbti) facts.push(profile.mbti);
  if (profile && profile.city) facts.push(profile.city);
  return {
    ...profile,
    avatarPath: avatarPathFromKind(profile && profile.avatarKind) || profileAvatarPath(gender),
    facts,
    factsLabel: facts.join('，'),
    interests: Array.isArray(profile && profile.interests) ? profile.interests.slice(0, 8) : [],
    interestsLabel: Array.isArray(profile && profile.interests) ? profile.interests.slice(0, 8).join('，') : '',
    accessibilityLabel: `${profile.nickname}的公开主页${profile.online ? '，正在找搭子' : ''}${facts.length ? `，${facts.join('，')}` : ''}`
  };
}

Page({
  data: {
    contentTopInset: 88,
    status: 'loading',
    profile: null,
    errorCopy: '',
    pageTitle: '搭子主页',
    communitySource: false
  },

  onLoad(options = {}) {
    this._disposed = false;
    this._loadSeq = 0;
    this.setData({ contentTopInset: calculateContentTopInset(typeof wx === 'undefined' ? null : wx) });
    if (typeof wx !== 'undefined' && typeof wx.hideShareMenu === 'function') wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
    let navigationKey = '';
    try { navigationKey = decodeURIComponent(options.k || ''); } catch (error) { navigationKey = ''; }
    const ticket = ephemeralProfileNavigation.consume(navigationKey);
    if (!ticket || !ticket.profileNavToken) {
      this.setData({ status: 'not-found' });
      return;
    }
    const communitySource = ticket.source === 'community';
    this.setData({ communitySource, pageTitle: communitySource ? '个人主页' : '搭子主页' });
    this._profileNavToken = ticket.profileNavToken;
    this.loadProfile();
  },

  onUnload() {
    this._disposed = true;
    this._loadSeq += 1;
    this._profileNavToken = '';
  },

  async loadProfile() {
    if (!this._profileNavToken) {
      this.setData({ status: 'not-found', profile: null });
      return;
    }
    const seq = ++this._loadSeq;
    this.setData({ status: 'loading', errorCopy: '' });
    try {
      const result = await publicProfileService.get(this._profileNavToken);
      if (this._disposed || seq !== this._loadSeq) return;
      this.setData({ status: 'ready', profile: publicView(result.profile) });
    } catch (error) {
      if (this._disposed || seq !== this._loadSeq) return;
      if (error && error.code === 'NOT_FOUND') {
        this._profileNavToken = '';
        this.setData({ status: 'not-found', profile: null });
        return;
      }
      this.setData({ status: 'error', profile: null, errorCopy: error && error.handled ? '个人资料暂时没有加载出来' : error.message || '请检查网络后重试' });
    }
  },

  handleRetry() { return this.loadProfile(); },

  handleBack() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    if (pages.length > 1) wx.navigateBack();
    else wx.switchTab({ url: '/pages/community/index' });
  }
});
