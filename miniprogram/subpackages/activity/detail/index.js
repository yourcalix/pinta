'use strict';

const activityService = require('../../../services/activity');
const userService = require('../../../services/user');
const { decorateActivity } = require('../../../utils/display');
const { decodeActivityId } = require('../../../utils/activity-route');
const { resolveDetailError } = require('../../../utils/detail-error');

Page({
  data: { id: '', activity: null, detailRows: [], loading: true, error: '', errorCode: '', applying: false, note: '', showApply: false },
  onLoad(options = {}) {
    this.setData({ id: decodeActivityId(options.id) });
    if (typeof wx !== 'undefined' && wx.showShareMenu) wx.showShareMenu({ menus: ['shareAppMessage'] });
  },
  onShow() { return this.loadDetail(); },
  onUnload() { this._loadSeq = (this._loadSeq || 0) + 1; },
  async loadDetail() {
    const loadSeq = (this._loadSeq = (this._loadSeq || 0) + 1);
    if (!this.data.id) {
      this.setData({ loading: false, activity: null, detailRows: [], errorCode: 'NOT_FOUND', error: '活动不存在或已失效' });
      return;
    }
    this.setData({ loading: true, activity: null, detailRows: [], error: '', errorCode: '' });
    try {
      const result = await activityService.detail(this.data.id);
      if (loadSeq !== this._loadSeq) return;
      this.setData({ activity: decorateActivity(result.activity), loading: false });
    } catch (error) {
      if (loadSeq !== this._loadSeq) return;
      this.setData({ loading: false, activity: null, detailRows: [], ...resolveDetailError(error) });
    }
  },
  handleRetry() { this.loadDetail(); },
  async handleApplyOpen() {
    try {
      const user = await userService.login();
      if (!user.profile || !user.profile.adultConfirmed) {
        const nextUrl = `/subpackages/activity/detail/index?id=${encodeURIComponent(this.data.id)}`;
        wx.navigateTo({ url: `/subpackages/profile/edit/index?next=${encodeURIComponent(nextUrl)}` });
        return;
      }
      this.setData({ showApply: true });
    } catch (error) { if (!error.handled) wx.showToast({ title: error.message || '暂时无法加入', icon: 'none' }); }
  },
  handleApplyClose() { if (!this.data.applying) this.setData({ showApply: false }); },
  handleNote(event) { this.setData({ note: event.detail.value }); },
  async handleApplySubmit() {
    if (this.data.applying) return;
    this.setData({ applying: true });
    try {
      await activityService.apply(this.data.id, this.data.note.trim());
      wx.showToast({ title: '申请已提交', icon: 'success' });
      this.setData({ showApply: false, note: '' });
      await this.loadDetail();
    } catch (error) {
      if (!error.handled) wx.showToast({ title: error.message || '申请失败', icon: 'none' });
    } finally { this.setData({ applying: false }); }
  },
  handleManage() { wx.navigateTo({ url: `/subpackages/activity/manage/index?id=${encodeURIComponent(this.data.id)}` }); },
  handleGroup() { wx.navigateTo({ url: `/subpackages/activity/group/index?id=${encodeURIComponent(this.data.id)}` }); },
  handleReport() { wx.navigateTo({ url: `/subpackages/safety/report/index?type=activity&id=${encodeURIComponent(this.data.id)}` }); },
  handleGoDiscover() { wx.switchTab({ url: '/pages/discover/index' }); },
  onShareAppMessage() {
    if (this.data.loading || this.data.errorCode || !this.data.activity || !this.data.id) {
      return { title: '拼吧｜发现有趣拼单', path: '/pages/discover/index' };
    }
    return { title: `拼吧｜${this.data.activity.title}`, path: `/subpackages/activity/detail/index?id=${encodeURIComponent(this.data.id)}` };
  }
});
