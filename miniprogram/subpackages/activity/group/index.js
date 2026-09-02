'use strict';

const activityService = require('../../../services/activity');
const directMessageService = require('../../../services/direct-message');
const { decorateActivity } = require('../../../utils/display');
const { buildActivityPath, decodeActivityId } = require('../../../utils/activity-route');
const { resolveProtectedPageError } = require('../../../utils/protected-page-error');

Page({
  data: { id: '', loading: true, error: '', errorCode: '', errorAction: '', errorActionText: '', activity: null, space: null, members: [], selfShared: false, pending: false, pendingMemberId: '' },

  onLoad(options = {}) { this.setData({ id: decodeActivityId(options.id) }); },
  onShow() { return this.loadDetail(); },
  onUnload() { this._loadSeq = (this._loadSeq || 0) + 1; },

  async loadDetail() {
    const loadSeq = (this._loadSeq = (this._loadSeq || 0) + 1);
    if (!this.data.id) {
      this.setData({ loading: false, activity: null, ...resolveProtectedPageError({ code: 'NOT_FOUND' }, 'group') });
      return;
    }
    this.setData({ loading: true, error: '', errorCode: '', errorAction: '', errorActionText: '' });
    try {
      const detail = await activityService.detail(this.data.id);
      const activity = decorateActivity(detail.activity);
      if (!['owner', 'member'].includes(activity.viewerRole) || !['FORMED', 'IN_PROGRESS', 'COMPLETED'].includes(activity.status)) {
        const conflict = new Error('成员空间仅对成团成员开放');
        conflict.code = 'CONFLICT';
        throw conflict;
      }
      const space = activity.status === 'COMPLETED' ? null : await activityService.groupSpace(this.data.id);
      const members = (space && space.members || []).map((item) => ({
        ...item,
        avatarLetter: item.nickname ? item.nickname.slice(0, 1) : '拼'
      }));
      if (loadSeq !== this._loadSeq) return;
      this.setData({
        activity,
        space,
        members,
        selfShared: members.some((item) => item.isSelf && item.sharedContact),
        loading: false
      });
    } catch (error) {
      if (loadSeq !== this._loadSeq) return;
      this.setData({ loading: false, activity: null, ...resolveProtectedPageError(error, 'group') });
    }
  },

  handleRetry() { this.loadDetail(); },
  handleErrorAction() {
    if (this.data.errorAction === 'RETRY') return this.loadDetail();
    if (this.data.errorAction === 'DETAIL') return wx.redirectTo({ url: buildActivityPath('DETAIL', this.data.id) });
    return wx.switchTab({ url: '/pages/discover/index' });
  },

  handleShareContact() {
    wx.showActionSheet({
      itemList: ['共享微信号', '共享手机号'],
      success: ({ tapIndex }) => {
        const type = tapIndex === 0 ? 'WECHAT' : 'MOBILE';
        wx.showModal({
          title: tapIndex === 0 ? '共享微信号' : '共享手机号',
          content: '仅当前有效成员可见；退出、取消或活动结束后将自动失效。',
          editable: true,
          placeholderText: tapIndex === 0 ? '请输入微信号' : '请输入手机号（可含国家区号）',
          confirmText: '确认共享',
          success: async (result) => {
            if (!result.confirm) return;
            this.setData({ pending: true });
            try {
              await activityService.shareContact(this.data.id, type, String(result.content || '').trim());
              await this.loadDetail();
              wx.showToast({ title: '已共享', icon: 'success' });
            } catch (error) {
              if (!error.handled) wx.showToast({ title: error.message || '共享失败', icon: 'none' });
            } finally {
              this.setData({ pending: false });
            }
          }
        });
      }
    });
  },

  async handleRevokeContact() {
    if (this.data.pending) return;
    this.setData({ pending: true });
    try {
      await activityService.revokeContact(this.data.id);
      await this.loadDetail();
      wx.showToast({ title: '已停止共享', icon: 'success' });
    } catch (error) {
      if (!error.handled) wx.showToast({ title: error.message || '操作失败', icon: 'none' });
    } finally {
      this.setData({ pending: false });
    }
  },

  async handleMessageMember(event) {
    const memberId = event.currentTarget.dataset.memberId;
    if (!memberId || this.data.pendingMemberId) return;
    this.setData({ pendingMemberId: memberId });
    try {
      const result = await directMessageService.createConversation(this.data.id, memberId);
      wx.navigateTo({ url: `/subpackages/message/chat/index?id=${encodeURIComponent(result.conversation.id)}` });
    } catch (error) {
      if (!error.handled) wx.showToast({ title: error.message || '暂时无法发起私信', icon: 'none' });
    } finally {
      this.setData({ pendingMemberId: '' });
    }
  },

  handleComplete() {
    wx.showModal({
      title: '标记活动已完成？',
      content: '完成后成员共享信息立即失效，活动进入历史记录。',
      success: async (result) => {
        if (!result.confirm) return;
        this.setData({ pending: true });
        try { await activityService.complete(this.data.id); await this.loadDetail(); }
        finally { this.setData({ pending: false }); }
      }
    });
  },

  handleLeave() {
    wx.showModal({
      title: '退出活动？',
      content: '退出后将立即失去成员空间与共享信息访问权限。',
      confirmColor: '#E5484D',
      success: async (result) => {
        if (!result.confirm) return;
        this.setData({ pending: true });
        try { await activityService.leave(this.data.id, '成员主动退出活动'); wx.navigateBack(); }
        finally { this.setData({ pending: false }); }
      }
    });
  },

  handleReport() {
    wx.navigateTo({ url: `/subpackages/safety/report/index?type=activity&id=${encodeURIComponent(this.data.id)}` });
  }
});
