'use strict';

const activityService = require('../../../services/activity');
const userService = require('../../../services/user');
const directMessageService = require('../../../services/direct-message');
const { decorateActivity } = require('../../../utils/display');
const { decodeActivityId } = require('../../../utils/activity-route');
const { resolveDetailError } = require('../../../utils/detail-error');
const { calculateContentTopInset } = require('../../../utils/navigation-layout');
const { normalizeAvatarSlots } = require('../../../utils/passenger-avatar');
const { formatDateTime } = require('../../../utils/date');

function presentation(activity) {
  const slots = normalizeAvatarSlots(activity.avatarSlots, activity.maxMembers);
  const supported = ['companion', 'sport', 'food'].includes(activity.typeTone);
  const data = activity.typeData || {};
  const fields = activity.typeTone === 'food' ? [['venue', '餐厅'], ['cuisine', '口味'], ['budgetRange', '人均预算'], ['dietaryNotes', '饮食偏好']]
    : activity.typeTone === 'sport' ? [['sportType', '运动项目'], ['venue', '场地'], ['equipment', '装备说明']]
      : [['originLabel', '出发地'], ['destinationLabel', '目的地']];
  let primaryAction = '', primaryLabel = activity.statusLabel;
  const legacy = activity.legacy && activity.legacy.readOnly;
  if (legacy) primaryLabel = '历史活动 · 仅供查看';
  else if (activity.viewerRole === 'owner' && activity.status === 'RECRUITING') { primaryAction = 'manage'; primaryLabel = '管理成员'; }
  else if (['owner', 'member'].includes(activity.viewerRole) && ['FORMED', 'IN_PROGRESS'].includes(activity.status)) { primaryAction = 'group'; primaryLabel = '进入成员空间'; }
  else if (activity.canApply) { primaryAction = 'apply'; primaryLabel = '加入成团'; }
  else if (activity.status === 'RECRUITING' && activity.viewerApplication && activity.viewerApplication.status === 'PENDING') primaryLabel = '申请审核中';
  else if (activity.status === 'RECRUITING' && activity.viewerRole === 'member') { primaryAction = 'group'; primaryLabel = '已加入 · 去空间'; }
  else if (activity.status === 'RECRUITING' && activity.remaining === 0) primaryLabel = '活动已满员';
  const needed = Math.max(0, activity.minMembers - activity.memberCount);
  return {
    coverSrc: supported ? `/assets/images/publish/publish-cover-${activity.typeTone}.webp` : '',
    coverFailed: false,
    deadlineLabel: formatDateTime(activity.deadlineAt),
    detailSlots: slots.slice(0, 6),
    hiddenMembers: slots.slice(6).filter(slot => !slot.empty).length,
    groupHint: activity.status === 'RECRUITING' && needed > 0 ? `还差 ${needed} 人达到成团人数` : `${activity.minMembers} 人成团 · 最多 ${activity.maxMembers} 人`,
    detailRows: fields.filter(([key]) => typeof data[key] === 'string' && data[key].trim()).map(([key, label]) => ({ key, label, value: data[key] })),
    primaryAction, primaryLabel,
    groupEnabled: ['owner', 'member'].includes(activity.viewerRole),
    consultEnabled: activity.viewerRole !== 'owner' && ['RECRUITING', 'FORMED', 'IN_PROGRESS'].includes(activity.status)
  };
}

Page({
  data: { id: '', activity: null, detailRows: [], loading: true, error: '', errorCode: '', applying: false, note: '', showApply: false,
    contentTopInset: 88, navTop: 36, singlePage: true, navSolid: false, coverSrc: '', coverFailed: false, detailSlots: [], hiddenMembers: 0, primaryAction: '', primaryLabel: '', opening: false, groupEnabled: false, consultEnabled: false, consulting: false },
  onLoad(options = {}) {
    this._disposed = false;
    const contentTopInset = calculateContentTopInset(typeof wx === 'undefined' ? null : wx);
    let singlePage = true;
    try { singlePage = typeof getCurrentPages !== 'function' || getCurrentPages().length <= 1; } catch (error) { /* Single-page fallback. */ }
    this.setData({ id: decodeActivityId(options.id), contentTopInset, navTop: Math.max(20, contentTopInset - 52), singlePage });
    if (typeof wx !== 'undefined' && wx.showShareMenu) wx.showShareMenu({ menus: ['shareAppMessage'] });
  },
  onShow() { this._visible = true; this.setData({ applying: Boolean(this._submitting), opening: Boolean(this._opening) }); return this.loadDetail(); },
  onReady() { if (this.data.activity) this.observeHero(); },
  observeHero() {
    if (typeof this.createIntersectionObserver !== 'function') return;
    if (this._heroObserver) this._heroObserver.disconnect();
    this._heroObserver = this.createIntersectionObserver({ thresholds: [0, 1] });
    this._heroObserver.relativeToViewport({ top: -this.data.contentTopInset }).observe('.hero-sentinel', result => {
      if (!this._disposed) this.setData({ navSolid: result.intersectionRatio === 0 && result.boundingClientRect.top < this.data.contentTopInset });
    });
  },
  onHide() { this._visible = false; this._loadSeq = (this._loadSeq || 0) + 1; this.setData({ showApply: false }); },
  onUnload() { this._disposed = true; this._visible = false; this._loadSeq = (this._loadSeq || 0) + 1; if (this._heroObserver) this._heroObserver.disconnect(); this._heroObserver = null; },
  handleBack() {
    let pages = [];
    try { pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []; } catch (error) { /* Fall back to discover. */ }
    if (pages.length > 1) wx.navigateBack({ delta: 1, fail: () => this.handleGoDiscover() });
    else this.handleGoDiscover();
  },
  handlePrimary() {
    if (this.data.primaryAction === 'apply') return this.handleApplyOpen();
    if (this.data.primaryAction === 'manage') return this.handleManage();
    if (this.data.primaryAction === 'group') return this.handleGroup();
  },
  preventScroll() {},
  handleCoverError() { this.setData({ coverFailed: true }); },
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
      const activity = decorateActivity(result.activity);
      this.setData({ activity, ...presentation(activity), loading: false }, () => this.observeHero());
    } catch (error) {
      if (loadSeq !== this._loadSeq) return;
      this.setData({ loading: false, activity: null, detailRows: [], ...resolveDetailError(error) });
    }
  },
  handleRetry() { this.loadDetail(); },
  async handleApplyOpen() {
    if (this._opening || this._submitting || !this.data.activity || !this.data.activity.canApply) return;
    this._opening = true;
    const seq = this._loadSeq;
    this.setData({ opening: true });
    try {
      const user = await userService.login();
      if (this._disposed || !this._visible || seq !== this._loadSeq) return;
      if (!user.profile || !user.profile.adultConfirmed) {
        const nextUrl = `/subpackages/activity/detail/index?id=${encodeURIComponent(this.data.id)}`;
        wx.navigateTo({ url: `/subpackages/profile/edit/index?next=${encodeURIComponent(nextUrl)}` });
        return;
      }
      this.setData({ showApply: true });
    } catch (error) { if (!this._disposed && this._visible && !error.handled) wx.showToast({ title: error.message || '暂时无法加入', icon: 'none' }); }
    finally { this._opening = false; if (!this._disposed && this._visible) this.setData({ opening: false }); }
  },
  handleApplyClose() { if (!this.data.applying) this.setData({ showApply: false }); },
  handleNote(event) { this.setData({ note: event.detail.value }); },
  async handleApplySubmit() {
    if (this._submitting || this.data.applying || !this.data.showApply || !this.data.activity || !this.data.activity.canApply) return;
    this._submitting = true;
    this.setData({ applying: true });
    try {
      await activityService.apply(this.data.id, this.data.note.trim());
      if (this._disposed) return;
      this.setData({ showApply: false, note: '' });
      if (!this._visible) return;
      wx.showToast({ title: '申请已提交', icon: 'success' });
      await this.loadDetail();
    } catch (error) {
      if (!this._disposed && this._visible && !error.handled) wx.showToast({ title: error.message || '申请失败', icon: 'none' });
    } finally { this._submitting = false; if (!this._disposed) this.setData({ applying: false }); }
  },
  handleManage() { wx.navigateTo({ url: `/subpackages/activity/manage/index?id=${encodeURIComponent(this.data.id)}` }); },
  handleGroup() { wx.navigateTo({ url: `/subpackages/activity/group/index?id=${encodeURIComponent(this.data.id)}` }); },
  handleGroupChat() {
    if (!this.data.activity || !this.data.groupEnabled) return wx.showToast({ title: '成员群聊仅对已加入成员开放', icon: 'none' });
    wx.navigateTo({ url: `/subpackages/message/group-chat/index?id=${encodeURIComponent(this.data.id)}` });
  },
  async handleConsult() {
    if (!this.data.activity || this._consulting) return;
    if (!this.data.consultEnabled) return wx.showToast({ title: this.data.activity.viewerRole === 'owner' ? '不能与自己发起私信' : '当前活动暂不可咨询', icon: 'none' });
    this._consulting = true; const seq = this._loadSeq; this.setData({ consulting: true });
    try {
      const user = await userService.login();
      if (this._disposed || !this._visible || seq !== this._loadSeq) return;
      if (!user.profile || !user.profile.adultConfirmed || !user.profile.gender) {
        const nextUrl = `/subpackages/activity/detail/index?id=${encodeURIComponent(this.data.id)}`;
        wx.navigateTo({ url: `/subpackages/profile/edit/index?next=${encodeURIComponent(nextUrl)}` });
        return;
      }
      const result = await directMessageService.createConsultConversation(this.data.id);
      if (this._disposed || !this._visible || seq !== this._loadSeq) return;
      wx.navigateTo({ url: `/subpackages/message/chat/index?id=${encodeURIComponent(result.conversation.id)}` });
    } catch (error) {
      if (!this._disposed && this._visible && !error.handled) wx.showToast({ title: error.message || '暂时无法联系发起人', icon: 'none' });
    } finally { this._consulting = false; if (!this._disposed) this.setData({ consulting: false }); }
  },
  handleReport() { wx.navigateTo({ url: `/subpackages/safety/report/index?type=activity&id=${encodeURIComponent(this.data.id)}` }); },
  handleGoDiscover() { wx.switchTab({ url: '/pages/discover/index' }); },
  onShareAppMessage() {
    if (this.data.loading || this.data.errorCode || !this.data.activity || !this.data.id) {
      return { title: '拼吧｜发现有趣拼单', path: '/pages/discover/index' };
    }
    return { title: `拼吧｜${this.data.activity.title}`, path: `/subpackages/activity/detail/index?id=${encodeURIComponent(this.data.id)}` };
  }
});
