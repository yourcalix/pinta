'use strict';

const publicProfileService = require('./service');
const ephemeralProfileNavigation = require('../../../services/ephemeral-profile-navigation');
const { calculateContentTopInset } = require('../../../utils/navigation-layout');
const { avatarKindFromGender, normalizeAvatarSlots, fallbackAvatarSlot } = require('../../../utils/passenger-avatar');

const INTEREST_TONES = Object.freeze(['amber', 'peach', 'mint', 'rose', 'amber', 'mint', 'peach', 'rose']);

function compactCount(value) {
  const count = Math.max(0, Math.floor(Number(value) || 0));
  return count > 999 ? '999+' : String(count);
}

function publicView(profile, communitySource) {
  const gender = profile && profile.gender;
  const age = Number(profile && profile.age);
  const facts = [];
  if (Number.isInteger(age) && age >= 18 && age <= 150) facts.push({ key: 'age', label: `${age}岁`, tone: 'neutral' });
  if (gender === 'FEMALE') facts.push({ key: 'gender', label: '女生', tone: 'neutral' });
  if (gender === 'MALE') facts.push({ key: 'gender', label: '男生', tone: 'neutral' });
  if (profile && profile.mbti) facts.push({ key: 'mbti', label: profile.mbti, tone: 'amber' });
  if (profile && profile.city) facts.push({ key: 'city', label: profile.city, tone: 'mint' });
  const legacyAvatar = { kind: 'DEFAULT', fallback: avatarKindFromGender(gender) };
  const avatarSlot = normalizeAvatarSlots([profile && profile.avatar || legacyAvatar], 1)[0];
  const interests = Array.isArray(profile && profile.interests)
    ? profile.interests.slice(0, 8).map((label, index) => ({ label, tone: INTEREST_TONES[index] }))
    : [];
  const nickname = String(profile && profile.nickname || '拼吧用户').trim() || '拼吧用户';
  const followingCount = Math.max(0, Number(profile && profile.followingCount) || 0);
  const followerCount = Math.max(0, Number(profile && profile.followerCount) || 0);
  return {
    ...profile,
    nickname,
    avatarSlot,
    avatarInitial: Array.from(nickname)[0] || '拼',
    facts,
    factsLabel: facts.map((item) => item.label).join('，'),
    interests,
    interestsLabel: interests.map((item) => item.label).join('，'),
    followingCount,
    followerCount,
    followingCountLabel: compactCount(followingCount),
    followerCountLabel: compactCount(followerCount),
    viewerFollowing: profile && profile.viewerFollowing === true,
    accessibilityLabel: `${nickname}的公开主页，${followingCount}个关注，${followerCount}个粉丝${!communitySource && profile.online ? '，正在找搭子' : ''}${facts.length ? `，${facts.map((item) => item.label).join('，')}` : ''}`
  };
}

Page({
  data: {
    contentTopInset: 88,
    status: 'loading',
    profile: null,
    errorCopy: '',
    pageTitle: '搭子主页',
    communitySource: false,
    directorySource: false
  },

  onLoad(options = {}) {
    this._disposed = false;
    this._loadSeq = 0;
    this._followPending = false;
    this.setData({ contentTopInset: calculateContentTopInset(typeof wx === 'undefined' ? null : wx) });
    if (typeof wx !== 'undefined' && typeof wx.hideShareMenu === 'function') wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
    let navigationKey = '';
    try { navigationKey = decodeURIComponent(options.k || ''); } catch (error) { navigationKey = ''; }
    const ticket = ephemeralProfileNavigation.consume(navigationKey);
    if (!ticket || !ticket.profileNavToken) {
      this.applyVisualTheme(false);
      this.setData({ status: 'not-found' });
      return;
    }
    const communitySource = ticket.source === 'community';
    const directorySource = ticket.source === 'companion-directory';
    this.applyVisualTheme(communitySource);
    this.setData({ communitySource, directorySource, pageTitle: communitySource ? '个人主页' : '搭子主页' });
    this._profileNavToken = ticket.profileNavToken;
    this.loadProfile();
  },

  onUnload() {
    this._disposed = true;
    this._loadSeq += 1;
    this._followPending = false;
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
      this.setData({ status: 'ready', profile: publicView(result.profile, this.data.communitySource) });
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

  applyVisualTheme(communitySource) {
    if (typeof wx === 'undefined') return;
    const backgroundColor = communitySource ? '#F9F7F2' : '#0D0C1B';
    const frontColor = communitySource ? '#000000' : '#ffffff';
    if (typeof wx.setNavigationBarColor === 'function') wx.setNavigationBarColor({ frontColor, backgroundColor, animation: { duration: 0, timingFunc: 'linear' } });
    if (typeof wx.setBackgroundColor === 'function') wx.setBackgroundColor({ backgroundColor, backgroundColorTop: backgroundColor, backgroundColorBottom: backgroundColor });
  },

  handleAvatarError() {
    const profile = this.data.profile;
    if (!profile || !profile.avatarSlot) return;
    const current = profile.avatarSlot;
    const fallback = fallbackAvatarSlot(current);
    const next = fallback !== current
      ? fallback
      : { ...current, kind: 'EMPTY', src: '', custom: false, failed: true, empty: true };
    this.setData({ 'profile.avatarSlot': next });
  },

  async handleToggleFollow() {
    const profile = this.data.profile;
    if (this._followPending || !this._profileNavToken || !profile || profile.viewerIsSelf) return;
    const previousFollowing = profile.viewerFollowing === true;
    const previousFollowerCount = Math.max(0, Number(profile.followerCount) || 0);
    const following = !previousFollowing;
    const optimisticFollowerCount = Math.max(0, previousFollowerCount + (following ? 1 : -1));
    this._followPending = true;
    this.setData({
      'profile.viewerFollowing': following,
      'profile.followerCount': optimisticFollowerCount,
      'profile.followerCountLabel': compactCount(optimisticFollowerCount)
    });
    try {
      const result = await publicProfileService.setFollow(this._profileNavToken, following);
      if (this._disposed) return;
      const followerCount = Math.max(0, Number(result.followerCount) || 0);
      this.setData({
        'profile.viewerFollowing': result.following === true,
        'profile.followerCount': followerCount,
        'profile.followerCountLabel': compactCount(followerCount)
      });
    } catch (error) {
      if (this._disposed) return;
      this.setData({
        'profile.viewerFollowing': previousFollowing,
        'profile.followerCount': previousFollowerCount,
        'profile.followerCountLabel': compactCount(previousFollowerCount)
      });
      if (!error || !error.handled) wx.showToast({
        title: error && error.code === 'NOT_FOUND' ? '主页访问已失效，请重新打开' : '操作失败，请稍后重试',
        icon: 'none'
      });
    } finally {
      this._followPending = false;
    }
  },

  handleBack() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    if (pages.length > 1) wx.navigateBack();
    else wx.switchTab({ url: '/pages/community/index' });
  }
});
