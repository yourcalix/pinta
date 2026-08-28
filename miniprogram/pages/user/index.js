'use strict';

const api = require('../../services/api');
const activityService = require('../../services/activity');
const userService = require('../../services/user');
const notificationRouter = require('../../services/notification-router');
const { decorateActivity } = require('../../utils/display');
const { formatDateTime } = require('../../utils/date');
const { calculateContentTopInset } = require('../../utils/navigation-layout');

async function optionalDriverRequest(request, fallback) {
  try {
    return await request();
  } catch (error) {
    if (error && error.handled) throw error;
    return fallback;
  }
}

Page({
  data: {
    contentTopInset: 88,
    loading: true,
    error: '',
    user: null,
    avatarLetter: '拼',
    isMock: api.isMock(),
    persona: api.getMockPersona(),
    personas: [
      { id: 'u_owner', label: '发起者“小拼”' },
      { id: 'u_member', label: '乘客“阿同”' },
      { id: 'u_driver', label: '司机“林师傅”' }
    ],
    tasks: [],
    owned: [],
    joined: [],
    currentList: 'owned',
    dashboardMode: 'rides',
    driverProfile: null,
    driverApplication: null,
    driverRides: []
  },

  onLoad() {
    this.setData({
      contentTopInset: calculateContentTopInset(typeof wx === 'undefined' ? null : wx)
    });
  },

  onShow() {
    this.loadDashboard();
  },

  async loadDashboard() {
    this.setData({ loading: true, error: '' });
    try {
      const user = await userService.login();
      const [mine, notifications, driverProfileResult, driverMineResult, driverApplicationResult] = await Promise.all([
        userService.mine(),
        userService.notifications(),
        optionalDriverRequest(() => activityService.driverProfile(), { driver: null }),
        optionalDriverRequest(() => activityService.driverMine(), { items: [] }),
        optionalDriverRequest(() => userService.getDriverApplication(), { application: null })
      ]);
      const tasks = notifications.items
        .filter((item) => !item.read)
        .slice(0, 5)
        .map((item) => notificationRouter.decorateNotification({
          ...item,
          displayTime: formatDateTime(item.createdAt)
        }));
      this.setData({
        user,
        avatarLetter: user.profile && user.profile.nickname ? user.profile.nickname.slice(0, 1) : '拼',
        tasks,
        owned: mine.owned.map(decorateActivity),
        joined: mine.joined.map(decorateActivity),
        driverProfile: driverProfileResult.driver,
        driverApplication: driverApplicationResult.application,
        driverRides: (driverMineResult.items || []).map((item) => ({
          id: item.activity.id,
          ...item,
          activity: decorateActivity(item.activity),
          pickupLabel: item.rideFulfillment && item.rideFulfillment.pickupAt
            ? formatDateTime(item.rideFulfillment.pickupAt)
            : '待确认'
        })),
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
        joined: [],
        driverProfile: null,
        driverRides: []
      });
    }
  },

  handleListChange(event) {
    this.setData({ currentList: event.currentTarget.dataset.value });
  },

  handleDashboardMode(event) {
    this.setData({ dashboardMode: event.currentTarget.dataset.value === 'driver' ? 'driver' : 'rides' });
  },

  handleDriverTask(event) {
    const item = event.currentTarget.dataset.item;
    if (!item || !item.activity) return;
    wx.navigateTo({ url: `/subpackages/activity/detail/index?id=${encodeURIComponent(item.activity.id)}&mode=driver` });
  },

  handleDriverApplicationInfo() {
    wx.navigateTo({ url: '/subpackages/profile/driver/index' });
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
    const url = notificationRouter.resolveNotificationPath(task);
    if (url === '/pages/discover/index') {
      wx.switchTab({ url });
      return;
    }
    wx.navigateTo({ url });
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
