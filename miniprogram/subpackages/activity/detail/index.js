'use strict';

const activityService = require('../../../services/activity');
const userService = require('../../../services/user');
const directMessageService = require('../../../services/direct-message');
const runtimeConfig = require('../../../config/runtime');
const { decorateActivity } = require('../../../utils/display');
const { decodeActivityId } = require('../../../utils/activity-route');
const { resolveDetailError } = require('../../../utils/detail-error');
const { calculateContentTopInset } = require('../../../utils/navigation-layout');
const { normalizeAvatarSlots, fallbackAvatarSlot, profileAvatarPath } = require('../../../utils/passenger-avatar');
const { formatDateTime } = require('../../../utils/date');
const { getProgressCard } = require('../config/progress-cards');
const { resolveProgressStage, resolveDebugProgressStage } = require('../utils/progress-resolver');
const progressStorage = require('../services/progress-storage');
const PROGRESS_CARD_DELAY_MS = 450;
const OWNER_MBTI_TYPES = new Set([
  'INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP',
  'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP'
]);
const BENEFIT_DEAL_LABELS = Object.freeze({
  FULL_REDUCTION: '满减优惠',
  GROUP_BUY: '团购价',
  COUPON_SHARE: '优惠券共享',
  MEMBERSHIP_SHARE: '会员权益共享',
  BUNDLE_DISCOUNT: '组合优惠',
  OTHER: '其他优惠'
});

function emptyProgressCard() {
  return { visible: false, image: '', stage: '', title: '', collecting: false };
}

function progressCandidate(activity) {
  if (!activity || !activity.id) return null;
  const debugStage = resolveDebugProgressStage(
    activity,
    runtimeConfig.progressCardDebugStage,
    runtimeConfig.useMock === true
  );
  const stage = debugStage || resolveProgressStage(activity);
  const card = stage && getProgressCard(stage);
  return card ? { ...card, activityId: activity.id } : null;
}

function publishedDateLabel(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '时间待确认';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function ownerAvatarPresentation(activity) {
  const raw = activity.ownerProfile && activity.ownerProfile.avatar;
  const slot = normalizeAvatarSlots(raw ? [raw] : [], 1)[0];
  if (!slot.empty) return { ...slot, id: 'owner-avatar' };
  const src = profileAvatarPath(null);
  return {
    ...slot,
    id: 'owner-avatar',
    kind: 'DEFAULT',
    src,
    fallbackSrc: src,
    mode: 'aspectFit',
    empty: false
  };
}

function ownerPersonalTags(profile) {
  const source = profile || {};
  const gender = source.gender === 'MALE' ? '男' : source.gender === 'FEMALE' ? '女' : '';
  const age = Number.isInteger(source.age) && source.age >= 18 && source.age <= 150 ? `${source.age}岁` : '';
  const tags = [];
  const identity = [gender, age].filter(Boolean).join(' · ');
  if (identity) tags.push({ key: 'identity', label: identity });
  if (OWNER_MBTI_TYPES.has(source.mbti)) tags.push({ key: 'mbti', label: source.mbti });
  return tags;
}

function meetingPointPresentation(activity) {
  const source = activity && activity.meetingPoint && typeof activity.meetingPoint === 'object'
    ? activity.meetingPoint
    : {};
  const label = String(source.label || '').trim();
  const address = String(source.address || '').trim();
  const fallback = String(activity && (activity.sceneLine || activity.placeLabel) || '').trim();
  if (label || address) {
    const lines = [label, address && address !== label ? address : ''].filter(Boolean);
    return {
      title: '集合地点',
      description: `${lines.join('\n')}\n\n该地点由发起人公开提供，活动前请与拼友在群内确认；暂不提供地图导航。`
    };
  }
  if (fallback) {
    return {
      title: '集合地点',
      description: `${fallback}\n\n暂无详细门牌地址。活动前请与拼友在群内确认。`
    };
  }
  return {
    title: '集合地点',
    description: '发起人暂未补充公开地点。\n\n请在加入后通过群聊或私信与发起人沟通确认。'
  };
}

function applyIneligibleMessage(activity) {
  if (!activity) return '当前活动暂不可申请';
  if (activity.viewerRole === 'owner') return '这是你发布的活动，可前往管理成员';
  if (activity.viewerRole === 'member' || activity.viewerMembership && activity.viewerMembership.status === 'ACTIVE') {
    return '你已经加入该活动';
  }
  if (activity.viewerApplication && activity.viewerApplication.status === 'PENDING') {
    return '申请已提交，等待发起人审核';
  }
  if (activity.remaining === 0) return '当前拼团名额已满';
  if (activity.status !== 'RECRUITING') return '当前活动暂不在招募中';
  return '当前活动暂不可申请';
}

function presentation(activity) {
  const slots = normalizeAvatarSlots(activity.avatarSlots, activity.maxMembers);
  const supported = ['companion', 'sport', 'food', 'benefit'].includes(activity.typeTone);
  const data = activity.typeData || {};
  const fields = activity.typeTone === 'benefit'
    ? [
        ['merchantOrPlatform', '商家 / 平台'],
        ['dealTypeLabel', '优惠类型'],
        ['offerThreshold', '优惠门槛'],
        ['targetPrice', '目标价格'],
        ['estimatedSaving', '预计节省'],
        ['fulfillmentLabel', '参与方式'],
        ['details', '优惠详情']
      ]
    : activity.typeTone === 'food' ? [['venue', '餐厅'], ['cuisine', '口味'], ['budgetRange', '人均预算'], ['dietaryNotes', '饮食偏好']]
    : activity.typeTone === 'sport' ? [['sportType', '运动项目'], ['venue', '场地'], ['equipment', '装备说明']]
      : [['originLabel', '出发地'], ['destinationLabel', '目的地']];
  const detailData = activity.typeTone === 'benefit' ? {
    ...data,
    dealTypeLabel: BENEFIT_DEAL_LABELS[data.dealType] || '',
    fulfillmentLabel: data.fulfillmentType === 'OFFLINE' ? '线下到店' : data.fulfillmentType === 'ONLINE' ? '线上拼单' : ''
  } : data;
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
  const ownerNickname = String(activity.ownerProfile && activity.ownerProfile.nickname || activity.ownerNickname || '拼吧用户').trim() || '拼吧用户';
  const ownerTags = ownerPersonalTags(activity.ownerProfile);
  const terminal = ['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(activity.status);
  const ownerPublishedLabel = publishedDateLabel(activity.createdAt);
  return {
    coverSrc: supported ? `/assets/images/publish/publish-cover-${activity.typeTone}.png` : '',
    coverFailed: false,
    deadlineLabel: formatDateTime(activity.deadlineAt),
    placeInfoLabel: activity.typeTone === 'benefit' ? '优惠信息' : '集合地点',
    canViewMeetingPoint: activity.typeTone !== 'benefit',
    safetyText: activity.typeTone === 'benefit'
      ? '平台仅提供信息撮合与成员交流，不代收款项、不承诺优惠有效性；请核验规则并通过官方渠道或当面结算。'
      : '成团后请在成员空间核验身份并自行确认安排；平台不提供运输、配送、担保或预订服务。',
    detailSlots: slots.slice(0, 6),
    hiddenMembers: slots.slice(6).filter(slot => !slot.empty).length,
    groupHint: activity.status === 'RECRUITING' && needed > 0 ? `还差 ${needed} 人达到成团人数` : `${activity.minMembers} 人成团 · 最多 ${activity.maxMembers} 人`,
    detailRows: fields.filter(([key]) => typeof detailData[key] === 'string' && detailData[key].trim()).map(([key, label]) => ({ key, label, value: detailData[key] })),
    ownerAvatar: ownerAvatarPresentation(activity),
    ownerNickname,
    ownerPersonalTags: ownerTags,
    ownerFacts: [
      { key: 'type', label: '活动类型', value: activity.typeLabel },
      { key: 'capacity', label: '成团规模', value: `${activity.minMembers}–${activity.maxMembers} 人` },
      { key: 'published', label: '发布时间', value: ownerPublishedLabel }
    ],
    ownerDutyText: terminal
      ? '活动已结束，历史记录仅供查看。'
      : '发起人负责本场成员确认与安排沟通，成团后可进入成员空间。',
    ownerAccessibilityLabel: `认识发起人，发起人${ownerNickname}，角色活动发起人${ownerTags.length ? `，${ownerTags.map(item => item.label).join('，')}` : ''}，活动类型${activity.typeLabel}，成团规模${activity.minMembers}至${activity.maxMembers}人，发布时间${ownerPublishedLabel}`,
    primaryAction, primaryLabel,
    groupEnabled: ['owner', 'member'].includes(activity.viewerRole),
    consultEnabled: activity.viewerRole !== 'owner' && ['RECRUITING', 'FORMED', 'IN_PROGRESS'].includes(activity.status)
  };
}

Page({
  data: { id: '', activity: null, detailRows: [], loading: true, error: '', errorCode: '', applying: false, note: '', showApply: false,
    contentTopInset: 88, navTop: 36, singlePage: true, navSolid: false, coverSrc: '', coverFailed: false, detailSlots: [], hiddenMembers: 0, ownerAvatar: null, ownerNickname: '', ownerPersonalTags: [], ownerFacts: [], ownerDutyText: '', ownerAccessibilityLabel: '', primaryAction: '', primaryLabel: '', opening: false, groupEnabled: false, consultEnabled: false, consulting: false,
    canViewMeetingPoint: false, meetingPointModalVisible: false, meetingPointModalTitle: '集合地点', meetingPointModalDescription: '',
    progressCard: emptyProgressCard() },
  onLoad(options = {}) {
    this._disposed = false;
    this._progressSessionSuppressed = new Set();
    this._progressPending = null;
    this._activeProgressCandidate = null;
    const contentTopInset = calculateContentTopInset(typeof wx === 'undefined' ? null : wx);
    let singlePage = true;
    try { singlePage = typeof getCurrentPages !== 'function' || getCurrentPages().length <= 1; } catch (error) { /* Single-page fallback. */ }
    this.setData({ id: decodeActivityId(options.id), contentTopInset, navTop: Math.max(20, contentTopInset - 52), singlePage });
    if (typeof wx !== 'undefined' && wx.showShareMenu) wx.showShareMenu({ menus: ['shareAppMessage'] });
  },
  onShow() {
    this._visible = true;
    this.setData({ applying: Boolean(this._submitting), opening: Boolean(this._opening) });
    return this.loadDetail();
  },
  onReady() { if (this.data.activity) this.observeHero(); },
  observeHero() {
    if (typeof this.createIntersectionObserver !== 'function') return;
    if (this._heroObserver) this._heroObserver.disconnect();
    this._heroObserver = this.createIntersectionObserver({ thresholds: [0, 1] });
    this._heroObserver.relativeToViewport({ top: -this.data.contentTopInset }).observe('.hero-sentinel', result => {
      if (!this._disposed) this.setData({ navSolid: result.intersectionRatio === 0 && result.boundingClientRect.top < this.data.contentTopInset });
    });
  },
  onHide() {
    this._visible = false;
    this._loadSeq = (this._loadSeq || 0) + 1;
    this.clearProgressCardTimer();
    if (this._activeProgressCandidate) this._progressSessionSuppressed.add(this._activeProgressCandidate.stage);
    this._progressPending = null;
    this._activeProgressCandidate = null;
    this.setData({ showApply: false, meetingPointModalVisible: false, 'progressCard.visible': false });
  },
  onUnload() {
    this._disposed = true;
    this._visible = false;
    this._loadSeq = (this._loadSeq || 0) + 1;
    this.clearProgressCardTimer();
    this._progressPending = null;
    this._activeProgressCandidate = null;
    this._userLoginPromise = null;
    if (this._heroObserver) this._heroObserver.disconnect();
    this._heroObserver = null;
  },
  clearProgressCardTimer() {
    if (this._progressTimer) clearTimeout(this._progressTimer);
    this._progressTimer = null;
  },
  async ensureUserSession() {
    if (this._userLoginPromise) return this._userLoginPromise;
    const pending = userService.login();
    this._userLoginPromise = pending;
    try {
      return await pending;
    } catch (error) {
      if (this._userLoginPromise === pending) this._userLoginPromise = null;
      throw error;
    }
  },
  async refreshApplySnapshot(activityId, loadSeq) {
    const result = await activityService.detail(activityId);
    if (this._disposed || !this._visible || loadSeq !== this._loadSeq || activityId !== this.data.id) return null;
    const activity = decorateActivity(result.activity);
    await new Promise((resolve) => this.setData({ activity, ...presentation(activity) }, resolve));
    if (this._disposed || !this._visible || loadSeq !== this._loadSeq || activityId !== this.data.id) return null;
    return activity;
  },
  async prepareProgressCard(activity, loadSeq) {
    const candidate = progressCandidate(activity);
    if (!candidate || this._progressSessionSuppressed.has(candidate.stage)) return;
    try {
      if (!progressStorage.hasActorScope()) await this.ensureUserSession();
    } catch (error) {
      return;
    }
    if (this._disposed || !this._visible || loadSeq !== this._loadSeq) return;
    if (!progressStorage.shouldPresent(candidate)) return;
    this._progressPending = candidate;
    this.scheduleProgressCard(PROGRESS_CARD_DELAY_MS);
  },
  scheduleProgressCard(delay = PROGRESS_CARD_DELAY_MS) {
    this.clearProgressCardTimer();
    if (!this._progressPending || this._disposed || !this._visible) return;
    this._progressTimer = setTimeout(() => {
      this._progressTimer = null;
      this.tryShowPendingProgressCard();
    }, delay);
  },
  tryShowPendingProgressCard() {
    const candidate = this._progressPending;
    if (!candidate || this._disposed || !this._visible || this.data.loading || this.data.errorCode || !this.data.activity) return;
    if (this.data.showApply || this.data.meetingPointModalVisible || this.data.progressCard.visible) return;
    const current = progressCandidate(this.data.activity);
    if (!current || current.activityId !== candidate.activityId || current.stage !== candidate.stage) {
      this._progressPending = null;
      return;
    }
    if (this._progressSessionSuppressed.has(candidate.stage) || !progressStorage.shouldPresent(candidate)) {
      this._progressPending = null;
      return;
    }
    this._progressPending = null;
    this._activeProgressCandidate = candidate;
    this.setData({
      progressCard: {
        visible: true,
        image: candidate.image,
        stage: candidate.stage,
        title: candidate.title,
        collecting: false
      }
    });
  },
  resumeProgressCard() {
    if (this._progressPending && !this.data.showApply && !this.data.meetingPointModalVisible) this.scheduleProgressCard(320);
  },
  suspendProgressCardForOverlay() {
    this.clearProgressCardTimer();
    if (!this.data.progressCard.visible || !this._activeProgressCandidate) return;
    this._progressSessionSuppressed.add(this._activeProgressCandidate.stage);
    this._activeProgressCandidate = null;
    this._progressPending = null;
    this.setData({ 'progressCard.visible': false });
  },
  closeActiveProgressCard() {
    if (!this._activeProgressCandidate) return null;
    const candidate = this._activeProgressCandidate;
    this._progressSessionSuppressed.add(candidate.stage);
    this._activeProgressCandidate = null;
    this.setData({ 'progressCard.visible': false, 'progressCard.collecting': false });
    return candidate;
  },
  handleProgressCollect() {
    const candidate = this._activeProgressCandidate;
    if (!candidate || this.data.progressCard.collecting) return;
    this.setData({ 'progressCard.collecting': true });
    progressStorage.markSeen(candidate);
    this.closeActiveProgressCard();
    wx.showToast({ title: '已收下卡片', icon: 'none' });
  },
  handleProgressLater() {
    const candidate = this._activeProgressCandidate;
    if (!candidate) return;
    progressStorage.snooze(candidate);
    this.closeActiveProgressCard();
  },
  handleProgressClose() { this.handleProgressLater(); },
  handleProgressImageError() {
    const candidate = this._activeProgressCandidate;
    if (candidate) this._progressSessionSuppressed.add(candidate.stage);
    this._activeProgressCandidate = null;
    this.setData({ progressCard: emptyProgressCard() });
    wx.showToast({ title: '新进度已解锁', icon: 'none' });
  },
  handleProgressClosed() {
    if (!this.data.progressCard.visible) this.setData({ progressCard: emptyProgressCard() });
  },
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
  handleOpenMeetingPointModal() {
    if (!this.data.activity || !this.data.canViewMeetingPoint) return;
    this.suspendProgressCardForOverlay();
    const modal = meetingPointPresentation(this.data.activity);
    this.setData({
      meetingPointModalVisible: true,
      meetingPointModalTitle: modal.title,
      meetingPointModalDescription: modal.description
    });
  },
  handleCloseMeetingPointModal() { this.setData({ meetingPointModalVisible: false }, () => this.resumeProgressCard()); },
  handleCoverError() { this.setData({ coverFailed: true }); },
  handleMemberAvatarError(event) {
    const dataset = event && event.currentTarget && event.currentTarget.dataset || {};
    const index = Number(dataset.index);
    if (!Number.isInteger(index) || index < 0 || index >= this.data.detailSlots.length) return;
    const current = this.data.detailSlots[index];
    if (!current || current.id !== dataset.slotId || current.src !== dataset.src) return;
    const next = fallbackAvatarSlot(current);
    if (!next || next === current) return;
    this.setData({ [`detailSlots[${index}]`]: next });
  },
  handleOwnerAvatarError(event) {
    const src = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.src;
    const current = this.data.ownerAvatar;
    if (!current || current.src !== src) return;
    const next = fallbackAvatarSlot(current);
    if (next && next !== current) {
      this.setData({ ownerAvatar: next });
      return;
    }
    const fallbackSrc = profileAvatarPath(null);
    if (current.failed || current.src === fallbackSrc) return;
    this.setData({ ownerAvatar: { ...current, kind: 'DEFAULT', src: fallbackSrc, fallbackSrc, custom: false, failed: true, mode: 'aspectFit', empty: false } });
  },
  async loadDetail() {
    const loadSeq = (this._loadSeq = (this._loadSeq || 0) + 1);
    this.clearProgressCardTimer();
    this._progressPending = null;
    this._activeProgressCandidate = null;
    if (!this.data.id) {
      this.setData({ loading: false, activity: null, detailRows: [], errorCode: 'NOT_FOUND', error: '活动不存在或已失效' });
      return;
    }
    this.setData({ loading: true, activity: null, detailRows: [], error: '', errorCode: '', 'progressCard.visible': false });
    try {
      const result = await activityService.detail(this.data.id);
      if (loadSeq !== this._loadSeq) return;
      const activity = decorateActivity(result.activity);
      this.setData({ activity, ...presentation(activity), loading: false }, () => {
        this.observeHero();
        this.prepareProgressCard(activity, loadSeq);
      });
    } catch (error) {
      if (loadSeq !== this._loadSeq) return;
      this.setData({ loading: false, activity: null, detailRows: [], ...resolveDetailError(error) });
    }
  },
  handleRetry() { this.loadDetail(); },
  async handleApplyOpen() {
    if (this._opening || this._submitting || !this.data.activity || !this.data.activity.canApply) return;
    this.suspendProgressCardForOverlay();
    this._opening = true;
    const seq = this._loadSeq;
    const activityId = this.data.id;
    this.setData({ opening: true });
    try {
      const user = await this.ensureUserSession();
      if (this._disposed || !this._visible || seq !== this._loadSeq) return;
      if (!user.profile || !user.profile.adultConfirmed) {
        const nextUrl = `/subpackages/activity/detail/index?id=${encodeURIComponent(this.data.id)}`;
        wx.navigateTo({ url: `/subpackages/profile/edit/index?next=${encodeURIComponent(nextUrl)}` });
        return;
      }
      const activity = await this.refreshApplySnapshot(activityId, seq);
      if (!activity) return;
      if (!activity.canApply) {
        wx.showToast({ title: applyIneligibleMessage(activity), icon: 'none' });
        return;
      }
      this.setData({ showApply: true });
    } catch (error) { if (!this._disposed && this._visible && !error.handled) wx.showToast({ title: error.message || '暂时无法加入', icon: 'none' }); }
    finally {
      this._opening = false;
      if (!this._disposed && this._visible) {
        this.setData({ opening: false }, () => {
          if (!this.data.showApply) this.resumeProgressCard();
        });
      }
    }
  },
  handleApplyClose() { if (!this.data.applying) this.setData({ showApply: false }, () => this.resumeProgressCard()); },
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
      const user = await this.ensureUserSession();
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
      return { title: '乐聚拼吧｜发现有趣拼单', path: '/pages/discover/index' };
    }
    return { title: `乐聚拼吧｜${this.data.activity.title}`, path: `/subpackages/activity/detail/index?id=${encodeURIComponent(this.data.id)}` };
  }
});
