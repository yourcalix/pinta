'use strict';

const userService = require('../../services/user');
const { calculateContentTopInset } = require('../../utils/navigation-layout');
const { selectTab } = require('../../utils/tab-bar');

const TYPE_META = Object.freeze({
  companion: {
    title: '拼同行',
    description: '找同路伙伴，一起商量出发方式',
    tone: 'companion',
    image: '../../assets/images/publish/publish-cover-companion.webp',
    ariaLabel: '发起拼同行，寻找同路伙伴，一起商量出发方式，点击进入发布表单'
  },
  sport: {
    title: '拼运动',
    description: '约球、跑步或组队，凑齐就开局',
    tone: 'sport',
    image: '../../assets/images/publish/publish-cover-sport.webp',
    ariaLabel: '发起拼运动，约球、跑步或组队，点击进入发布表单'
  },
  food: {
    title: '拼饭桌',
    description: '约饭拼桌，一起探索附近好味道',
    tone: 'food',
    image: '../../assets/images/publish/publish-cover-food.webp',
    ariaLabel: '发起拼饭桌，约饭拼桌，一起探索附近好味道，点击进入发布表单'
  }
});
const TYPE_VALUES = Object.freeze(Object.keys(TYPE_META));
const DRAFT_FIELDS = Object.freeze({
  companion: ['title', 'description', 'rules', 'startDate', 'startTime', 'originLabel', 'destinationLabel'],
  sport: ['title', 'description', 'rules', 'startDate', 'startTime', 'sportType', 'venue', 'equipment'],
  food: ['title', 'description', 'rules', 'startDate', 'startTime', 'venue', 'cuisine', 'budgetRange', 'dietaryNotes']
});

function hasMeaningfulDraft(draft, type) {
  if (!draft || typeof draft !== 'object' || !draft.form || typeof draft.form !== 'object') return false;
  return DRAFT_FIELDS[type].some((field) => {
    const value = draft.form[field];
    return typeof value === 'string' ? value.trim().length > 0 : value !== undefined && value !== null && value !== '';
  }) || draft.safetyAgreed === true;
}

function readLatestDraft(platform) {
  if (!platform || typeof platform.getStorageSync !== 'function') return null;
  const candidates = [];
  TYPE_VALUES.forEach((type) => {
    let stored;
    try {
      stored = platform.getStorageSync(`pinba_publish_draft_${type}`);
    } catch (error) {
      stored = null;
    }
    if (!hasMeaningfulDraft(stored, type)) return;
    const title = typeof stored.form.title === 'string' ? stored.form.title.trim() : '';
    candidates.push({
      type,
      typeTitle: TYPE_META[type].title,
      title: title || `未完成的${TYPE_META[type].title}活动`,
      savedAt: Number(stored.savedAt) || 0
    });
  });
  candidates.sort((left, right) => right.savedAt - left.savedAt);
  return candidates[0] || null;
}

Page({
  data: {
    contentTopInset: 88,
    types: TYPE_VALUES.map((value) => ({ value, ...TYPE_META[value] })),
    draft: null,
    pending: false
  },

  onLoad() {
    this.setData({ contentTopInset: calculateContentTopInset(typeof wx === 'undefined' ? null : wx) });
  },

  onShow() {
    selectTab(this, 2);
    this.refreshDraft();
  },

  refreshDraft() {
    this.setData({ draft: readLatestDraft(typeof wx === 'undefined' ? null : wx) });
  },

  handleSelect(event) {
    return this.openForm(event.currentTarget.dataset.type);
  },

  handleContinueDraft() {
    if (!this.data.draft) return Promise.resolve(false);
    return this.openForm(this.data.draft.type);
  },

  async openForm(type) {
    if (this.data.pending || !TYPE_VALUES.includes(type)) return false;
    this.setData({ pending: true });
    try {
      const user = await userService.login();
      const nextUrl = `/subpackages/publish/form/index?type=${type}`;
      if (!user.profile || !user.profile.adultConfirmed) {
        wx.navigateTo({ url: `/subpackages/profile/edit/index?next=${encodeURIComponent(nextUrl)}` });
        return true;
      }
      wx.navigateTo({ url: nextUrl });
      return true;
    } catch (error) {
      if (!error.handled) wx.showToast({ title: error.message || '暂时无法登录', icon: 'none' });
      return false;
    } finally {
      this.setData({ pending: false });
    }
  },

  handleSafetyNotice() {
    wx.showModal({
      title: '拼单安全边界',
      content: '拼吧只提供活动信息撮合与成员协作空间，不提供商业运输、外卖配送、资金担保或场地预订服务。请在成团后自行核验成员信息并确认具体安排。',
      showCancel: false,
      confirmText: '我知道了'
    });
  }
});

module.exports = { hasMeaningfulDraft, readLatestDraft };
