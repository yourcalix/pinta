'use strict';

const activityService = require('../../../services/activity');
const { decorateActivity } = require('../../../utils/display');
const { formatDateTime } = require('../../../utils/date');
const { buildActivityPath, decodeActivityId } = require('../../../utils/activity-route');
const { resolveProtectedPageError } = require('../../../utils/protected-page-error');

const APPLICATION_META = {
  PENDING: { label: '待处理', tone: 'success' },
  APPROVED: { label: '已加入', tone: 'info' },
  REJECTED: { label: '已拒绝', tone: 'muted' },
  WITHDRAWN: { label: '已撤回', tone: 'muted' },
  LEFT: { label: '已退团', tone: 'muted' },
  CANCELLED_BY_ACTIVITY: { label: '名额已关闭', tone: 'muted' }
};

function decorateApplication(item) {
  const meta = APPLICATION_META[item.status] || APPLICATION_META.WITHDRAWN;
  return {
    ...item,
    avatarLetter: item.applicant && item.applicant.nickname ? item.applicant.nickname.slice(0, 1) : '拼',
    statusLabel: meta.label,
    statusTone: meta.tone,
    displayTime: formatDateTime(item.createdAt)
  };
}

Page({
  data: {
    id: '',
    loading: true,
    error: '',
    errorCode: '',
    errorAction: '',
    errorActionText: '',
    activity: null,
    applications: [],
    pendingId: ''
  },

  onLoad(options = {}) {
    this.setData({ id: decodeActivityId(options.id) });
  },

  onShow() {
    return this.loadData();
  },

  onUnload() {
    this._loadSeq = (this._loadSeq || 0) + 1;
  },

  async loadData() {
    const loadSeq = (this._loadSeq = (this._loadSeq || 0) + 1);
    if (!this.data.id) {
      this.setData({
        loading: false,
        activity: null,
        applications: [],
        ...resolveProtectedPageError({ code: 'NOT_FOUND' }, 'manage')
      });
      return;
    }
    this.setData({
      loading: true,
      error: '',
      errorCode: '',
      errorAction: '',
      errorActionText: '',
      activity: null,
      applications: []
    });
    try {
      const detail = await activityService.detail(this.data.id);
      const result = await activityService.applications(this.data.id);
      if (loadSeq !== this._loadSeq) return;
      this.setData({
        activity: decorateActivity(detail.activity),
        applications: result.items.map(decorateApplication),
        loading: false
      });
    } catch (error) {
      if (loadSeq !== this._loadSeq) return;
      this.setData({
        loading: false,
        activity: null,
        applications: [],
        ...resolveProtectedPageError(error, 'manage')
      });
    }
  },

  handleErrorAction() {
    if (this.data.errorAction === 'RETRY') {
      this.loadData();
      return;
    }
    if (this.data.errorAction === 'DETAIL') {
      wx.redirectTo({ url: buildActivityPath('DETAIL', this.data.id) });
      return;
    }
    wx.switchTab({ url: '/pages/discover/index' });
  },

  handleApprove(event) {
    const applicationId = event.currentTarget.dataset.id;
    wx.showModal({
      title: '同意加入？',
      content: '同意后对方会自动加入并占用名额；达到目标人数时活动自动成团。',
      confirmText: '同意加入',
      success: async (result) => {
        if (!result.confirm) return;
        this.setData({ pendingId: applicationId });
        try {
          const response = await activityService.approve(this.data.id, applicationId);
          wx.showToast({ title: response.activity.status === 'FORMED' ? '已成团' : '已批准', icon: 'success' });
          await this.loadData();
        } catch (error) {
          if (!error.handled) wx.showToast({ title: error.message || '处理失败', icon: 'none' });
        } finally {
          this.setData({ pendingId: '' });
        }
      }
    });
  },

  async handleReject(event) {
    const applicationId = event.currentTarget.dataset.id;
    if (this.data.pendingId) return;
    this.setData({ pendingId: applicationId });
    try {
      await activityService.reject(applicationId);
      wx.showToast({ title: '已拒绝', icon: 'success' });
      await this.loadData();
    } catch (error) {
      if (!error.handled) wx.showToast({ title: error.message || '处理失败', icon: 'none' });
    } finally {
      this.setData({ pendingId: '' });
    }
  },

  handleGroup() {
    wx.navigateTo({ url: `/subpackages/activity/group/index?id=${this.data.id}` });
  },

  handleCancel() {
    wx.showModal({
      title: '取消整个活动？',
      content: '所有申请人都会看到活动已取消。该操作不能恢复。',
      confirmText: '确认取消',
      confirmColor: '#E5484D',
      success: async (result) => {
        if (!result.confirm) return;
        try {
          await activityService.cancel(this.data.id, '发起者计划变化，主动取消活动');
          wx.showToast({ title: '活动已取消', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 400);
        } catch (error) {
          if (!error.handled) wx.showToast({ title: error.message || '取消失败', icon: 'none' });
        }
      }
    });
  }
});
