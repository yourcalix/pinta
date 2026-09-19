'use strict';

const profileFollowService = require('../../../services/profile-follow');
const ephemeralProfileNavigation = require('../../../services/ephemeral-profile-navigation');
const { normalizeAvatarSlots, fallbackAvatarSlot } = require('../../../utils/passenger-avatar');

const TYPES = Object.freeze(['FOLLOWING', 'FOLLOWERS']);
const PAGE_SIZE = 20;
const EXPIRY_BUFFER_MS = 5000;

function createTabData() {
  return { items: [], cursor: '', hasMore: true, loaded: false };
}

function compactCount(value) {
  const count = Math.max(0, Math.floor(Number(value) || 0));
  return count > 999 ? '999+' : String(count);
}

function decorateMember(item) {
  const displayItem = { ...item };
  delete displayItem.profileNavToken;
  delete displayItem.profileNavExpiresAt;
  const facts = [];
  if (Number.isInteger(item.age) && item.age >= 18 && item.age <= 150) facts.push(`${item.age}岁`);
  if (item.mbti) facts.push(item.mbti);
  if (item.city) facts.push(item.city);
  const interests = Array.isArray(item.interests) ? item.interests.filter(Boolean).slice(0, 3) : [];
  return {
    ...displayItem,
    avatarSlot: normalizeAvatarSlots([item.avatar], 1)[0],
    relationLabel: item.mutual ? '互相关注' : item.viewerFollowing ? '已关注' : '关注了你',
    factsLabel: facts.join(' · '),
    interestsLabel: interests.join(' · '),
    accessibilityLabel: `${item.nickname || '拼吧用户'}，${item.mutual ? '互相关注' : item.viewerFollowing ? '已关注' : '关注了你'}，点击查看公开主页`
  };
}

Page({
  data: {
    currentType: 'FOLLOWING',
    status: 'loading',
    items: [],
    followingCountLabel: '0',
    followerCountLabel: '0',
    hasMore: false,
    loadingMore: false
  },

  onLoad(options = {}) {
    this._disposed = false;
    this._requestSeq = 0;
    this._loadingMore = false;
    this._navigationPending = false;
    this._refreshOnShow = false;
    this._tabData = { FOLLOWING: createTabData(), FOLLOWERS: createTabData() };
    this._credentialsByTab = { FOLLOWING: new Map(), FOLLOWERS: new Map() };
    const currentType = TYPES.includes(options.type) ? options.type : 'FOLLOWING';
    this.setData({ currentType });
    this.loadTab(currentType);
  },

  onShow() {
    this._disposed = false;
    if (!this._refreshOnShow) return;
    this._refreshOnShow = false;
    this.loadTab(this.data.currentType, { silent: true });
  },

  onHide() {
    this._refreshOnShow = true;
    this._requestSeq += 1;
    this._loadingMore = false;
  },

  onUnload() {
    this._disposed = true;
    this._requestSeq += 1;
    this._loadingMore = false;
    this._navigationPending = false;
    TYPES.forEach((type) => this._credentialsByTab[type].clear());
  },

  async loadTab(type, options = {}) {
    if (!TYPES.includes(type) || this._disposed) return;
    const append = options.append === true;
    const silent = options.silent === true;
    const tab = this._tabData[type];
    if (append && (!tab.hasMore || this._loadingMore)) return;
    const seq = ++this._requestSeq;
    if (append) this._loadingMore = true;
    if (type === this.data.currentType) {
      if (append) this.setData({ loadingMore: true });
      else if (!silent || !tab.items.length) this.setData({ status: 'loading', items: tab.items, hasMore: tab.hasMore });
    }
    try {
      const result = await profileFollowService.list(type, append ? tab.cursor : '', PAGE_SIZE);
      if (this._disposed || seq !== this._requestSeq) return;
      const credentials = this._credentialsByTab[type];
      if (!append) credentials.clear();
      const nextItems = (result.items || []).map((item) => {
        credentials.set(item.memberKey, {
          profileNavToken: item.profileNavToken,
          profileNavExpiresAt: item.profileNavExpiresAt
        });
        return decorateMember(item);
      });
      tab.items = append ? tab.items.concat(nextItems) : nextItems;
      tab.cursor = result.nextCursor || '';
      tab.hasMore = result.hasMore === true && Boolean(tab.cursor);
      tab.loaded = true;
      const summary = result.summary || {};
      const view = {
        followingCountLabel: compactCount(summary.followingCount),
        followerCountLabel: compactCount(summary.followerCount)
      };
      if (type === this.data.currentType) Object.assign(view, {
        items: tab.items,
        status: tab.items.length ? 'ready' : 'empty',
        hasMore: tab.hasMore,
        loadingMore: false
      });
      this.setData(view);
    } catch (error) {
      if (this._disposed || seq !== this._requestSeq) return;
      if (type === this.data.currentType) {
        if (tab.items.length) {
          this.setData({ status: 'ready', loadingMore: false });
          if (typeof wx !== 'undefined') wx.showToast({ title: append ? '加载更多失败' : '刷新失败，请稍后重试', icon: 'none' });
        } else {
          this.setData({ status: 'error', items: [], hasMore: false, loadingMore: false });
        }
      }
    } finally {
      if (append) this._loadingMore = false;
      if (typeof wx !== 'undefined' && typeof wx.stopPullDownRefresh === 'function') wx.stopPullDownRefresh();
    }
  },

  handleTabChange(event) {
    const type = event.currentTarget.dataset.type;
    if (!TYPES.includes(type) || type === this.data.currentType) return;
    this._requestSeq += 1;
    this._loadingMore = false;
    const tab = this._tabData[type];
    this.setData({
      currentType: type,
      items: tab.items,
      status: tab.loaded ? (tab.items.length ? 'ready' : 'empty') : 'loading',
      hasMore: tab.hasMore,
      loadingMore: false
    });
    if (!tab.loaded) this.loadTab(type);
  },

  handleRetry() {
    return this.loadTab(this.data.currentType);
  },

  onPullDownRefresh() {
    return this.loadTab(this.data.currentType, { silent: true });
  },

  onReachBottom() {
    return this.loadTab(this.data.currentType, { append: true, silent: true });
  },

  async handleMemberTap(event) {
    if (this._navigationPending) return;
    const index = Number(event.currentTarget.dataset.index);
    const type = this.data.currentType;
    let member = this._tabData[type].items[index];
    if (!Number.isInteger(index) || !member) return;
    let credential = this._credentialsByTab[type].get(member.memberKey);
    if (!credential || Date.parse(credential.profileNavExpiresAt) <= Date.now() + EXPIRY_BUFFER_MS) {
      await this.loadTab(type, { silent: true });
      if (this._disposed || type !== this.data.currentType) return;
      member = this._tabData[type].items.find((item) => item.memberKey === member.memberKey);
      credential = member && this._credentialsByTab[type].get(member.memberKey);
    }
    if (!member || !credential || !credential.profileNavToken || Date.parse(credential.profileNavExpiresAt) <= Date.now() + EXPIRY_BUFFER_MS) {
      if (typeof wx !== 'undefined') wx.showToast({ title: '主页凭据已更新，请重试', icon: 'none' });
      return;
    }
    this._navigationPending = true;
    const ttlMs = Math.min(15000, Math.max(1000, Date.parse(credential.profileNavExpiresAt) - Date.now() - EXPIRY_BUFFER_MS));
    const key = ephemeralProfileNavigation.issue({ profileNavToken: credential.profileNavToken, source: 'social' }, ttlMs);
    wx.navigateTo({
      url: `/subpackages/profile/public/index?k=${encodeURIComponent(key)}`,
      fail: () => ephemeralProfileNavigation.revoke(key),
      complete: () => { this._navigationPending = false; }
    });
  },

  handleAvatarError(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.items[index];
    if (!Number.isInteger(index) || !item || item.memberKey !== event.currentTarget.dataset.key) return;
    const next = fallbackAvatarSlot(item.avatarSlot);
    if (!next || next === item.avatarSlot) return;
    this.setData({ [`items[${index}].avatarSlot`]: next });
    const cached = this._tabData[this.data.currentType].items[index];
    if (cached && cached.memberKey === item.memberKey) cached.avatarSlot = next;
  }
});
