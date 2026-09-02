'use strict';

const api = require('../../services/api');
const activityService = require('../../services/activity');
const userService = require('../../services/user');
const notificationRouter = require('../../services/notification-router');
const { decorateActivity } = require('../../utils/display');
const { formatDateTime } = require('../../utils/date');
const { calculateContentTopInset } = require('../../utils/navigation-layout');
const { profileAvatarPath } = require('../../utils/passenger-avatar');
const { selectTab, refreshUnread } = require('../../utils/tab-bar');

Page({
  data: {
    contentTopInset: 88,
    loading: true,
    error: '',
    user: null,
    profileAvatarPath: profileAvatarPath(null),
    profileGenderLabel: '性别未设置',
    currentList: 'owned',
    owned: [], joined: [], formed: [], history: [], currentItems: [], tasks: [],
    isMock: api.isMock(),
    persona: api.getMockPersona(),
    personas: [
      { id: 'u_owner', label: '发起者“小拼”' },
      { id: 'u_member', label: '参与者“阿同”' },
      { id: 'u_student', label: '普通用户“小满”' }
    ]
  },

  onLoad() {
    this.setData({ contentTopInset: calculateContentTopInset(typeof wx === 'undefined' ? null : wx) });
  },

  onShow() {
    selectTab(this, 4);
    refreshUnread(this);
    return this.loadDashboard();
  },

  async loadDashboard() {
    const seq = (this._loadSeq = (this._loadSeq || 0) + 1);
    this.setData({ loading: true, error: '' });
    try {
      const user = await userService.login();
      const [mineResult, notificationResult] = await Promise.allSettled([
        userService.mine(),
        userService.notifications()
      ]);
      if (mineResult.status === 'rejected') throw mineResult.reason;
      const mine = mineResult.value || { owned: [], joined: [] };
      const notifications = notificationResult.status === 'fulfilled'
        ? notificationResult.value || { items: [] }
        : { items: [] };
      if (seq !== this._loadSeq) return;
      const owned = (mine.owned || []).map(decorateActivity);
      const joined = (mine.joined || []).map(decorateActivity);
      const all = [...owned, ...joined];
      const formed = all.filter((item) => ['FORMED', 'IN_PROGRESS'].includes(item.status));
      const history = all.filter((item) => ['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(item.status));
      const lists = { owned, joined, formed, history };
      this.setData({
        user,
        profileAvatarPath: profileAvatarPath(user.profile && user.profile.gender),
        profileGenderLabel: user.profile && user.profile.gender === 'MALE' ? '男' : user.profile && user.profile.gender === 'FEMALE' ? '女' : '性别未设置',
        owned,
        joined,
        formed,
        history,
        currentItems: lists[this.data.currentList] || owned,
        tasks: (notifications.items || []).filter((item) => !item.read).map((item) => ({ ...item, displayTime: formatDateTime(item.createdAt), actionLabel: '去处理' })),
        persona: api.getMockPersona(),
        loading: false
      });
    } catch (error) {
      if (seq !== this._loadSeq) return;
      this.setData({ loading: false, error: error.handled ? '账号暂时无法使用' : error.message || '加载失败，请重试' });
    }
  },

  handleListChange(event) {
    const currentList = event.currentTarget.dataset.value || 'owned';
    this.setData({ currentList, currentItems: this.data[currentList] || [] });
  },

  handleActivitySelect(event) {
    const id = event.detail && event.detail.id;
    const item = [...this.data.owned, ...this.data.joined].find((activity) => activity.id === id);
    if (!item) return;
    const activityId = encodeURIComponent(item.id);
    if (item.viewerRole === 'owner' && item.status === 'RECRUITING') return wx.navigateTo({ url: `/subpackages/activity/manage/index?id=${activityId}` });
    if (['FORMED', 'IN_PROGRESS'].includes(item.status) && ['owner', 'member'].includes(item.viewerRole)) return wx.navigateTo({ url: `/subpackages/activity/group/index?id=${activityId}` });
    wx.navigateTo({ url: `/subpackages/activity/detail/index?id=${activityId}` });
  },

  async handleTaskTap(event) {
    const task = event.currentTarget.dataset.task;
    try { await userService.readNotification(task.id); } catch (error) { if (error.handled) return; }
    const url = notificationRouter.resolveNotificationPath(task);
    if (url === '/pages/discover/index') return wx.switchTab({ url });
    wx.navigateTo({ url });
  },

  handleProfile() { wx.navigateTo({ url: '/subpackages/profile/edit/index' }); },

  handlePersona(event) {
    if (!api.setMockPersona(event.currentTarget.dataset.id)) return;
    getApp().globalData.user = null;
    this.loadDashboard();
  },

  handleResetDemo() {
    wx.showModal({ title: '重置演示数据？', content: '会恢复示例活动和初始申请。', confirmText: '重置', success: (result) => { if (result.confirm) { api.resetMock(); getApp().globalData.user = null; this.loadDashboard(); } } });
  }
});
