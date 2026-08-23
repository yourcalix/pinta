'use strict';

const api = require('../../services/api');
const userService = require('../../services/user');
const { decorateActivity } = require('../../utils/display');
const { formatDateTime } = require('../../utils/date');

Page({
  data: {
    loading: true,
    error: '',
    user: null,
    avatarLetter: '拼',
    isMock: api.isMock(),
    persona: api.getMockPersona(),
    personas: [
      { id: 'u_owner', label: '发起者“小拼”' },
      { id: 'u_member', label: '参与者“阿同”' }
    ],
    tasks: [],
    owned: [],
    joined: [],
    currentList: 'owned'
  },

  onShow() {
    this.loadDashboard();
  },

  async loadDashboard() {
    this.setData({ loading: true, error: '' });
    try {
      const user = await userService.login();
      const [mine, notifications] = await Promise.all([
        userService.mine(),
        userService.notifications()
      ]);
      const tasks = notifications.items
        .filter((item) => !item.read)
        .slice(0, 5)
        .map((item) => ({ ...item, displayTime: formatDateTime(item.createdAt) }));
      this.setData({
        user,
        avatarLetter: user.profile && user.profile.nickname ? user.profile.nickname.slice(0, 1) : '拼',
        tasks,
        owned: mine.owned.map(decorateActivity),
        joined: mine.joined.map(decorateActivity),
        persona: api.getMockPersona(),
        loading: false
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: error.handled ? '账号暂时无法使用' : error.message || '加载失败，请重试',
        user: null,
        tasks: [],
        owned: [],
        joined: []
      });
    }
  },

  handleListChange(event) {
    this.setData({ currentList: event.currentTarget.dataset.value });
  },

  handleActivityTap(event) {
    const item = event.currentTarget.dataset.item;
    if (item.viewerRole === 'owner' && item.status === 'RECRUITING') {
      wx.navigateTo({ url: `/subpackages/activity/manage/index?id=${item.id}` });
      return;
    }
    if (['FORMED', 'IN_PROGRESS'].includes(item.status) && ['owner', 'member'].includes(item.viewerRole)) {
      wx.navigateTo({ url: `/subpackages/activity/group/index?id=${item.id}` });
      return;
    }
    wx.navigateTo({ url: `/subpackages/activity/detail/index?id=${item.id}` });
  },

  async handleTaskTap(event) {
    const task = event.currentTarget.dataset.task;
    try {
      await userService.readNotification(task.id);
    } catch (error) {
      if (error.handled) return;
      // Navigation is still useful if marking read fails.
    }
    wx.navigateTo({ url: `/subpackages/activity/detail/index?id=${task.activityId}` });
  },

  handleProfile() {
    wx.navigateTo({ url: '/subpackages/profile/edit/index' });
  },

  handlePersona(event) {
    const id = event.currentTarget.dataset.id;
    if (api.setMockPersona(id)) {
      getApp().globalData.user = null;
      this.loadDashboard();
    }
  },

  handleResetDemo() {
    wx.showModal({
      title: '重置演示数据？',
      content: '会恢复三条示例活动和初始申请，不影响任何真实云端数据。',
      confirmText: '重置',
      success: (result) => {
        if (!result.confirm) return;
        api.resetMock();
        getApp().globalData.user = null;
        this.loadDashboard();
      }
    });
  }
});
