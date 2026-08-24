'use strict';

const activityService = require('../../../services/activity');
const userService = require('../../../services/user');
const subscriptionService = require('../../../services/subscription');
const { decorateActivity } = require('../../../utils/display');
const { resolveDetailError } = require('../../../utils/detail-error');
const { decodeActivityId } = require('../../../utils/activity-route');

const FEE_LABELS = { FREE: '免费互助', SHARED_COST: '合理成本均摊', NO_COST: '不涉及费用' };
const LUGGAGE_LABELS = { NO_LARGE: '无大件行李', ONE_SMALL: '每人一件小行李', TRUNK_OK: '可放后备箱' };
const DELIVERY_LABELS = { FACE_TO_FACE: '当面验货交付', PICKUP: '指定商圈自提', ARRANGE_AFTER_FORMED: '成团后协商' };
const COST_LABELS = { AA: 'AA制', SELF_PAY: '费用自理', HOST_TREATS: '发起者请客' };
const LEVEL_LABELS = { BEGINNER: '新手友好', INTERMEDIATE: '需一定基础', ADVANCED: '进阶专业' };
const DISCOVER_SHARE = Object.freeze({
  title: '拼吧｜发现附近的组团活动',
  path: '/pages/discover/index'
});
const QA_PREVIEW_LIMIT = 3;
const QA_PAGE_LIMIT = 10;
const QA_ASK_STATUSES = Object.freeze(['RECRUITING', 'FORMED']);
const QA_ANSWER_STATUSES = Object.freeze(['RECRUITING', 'FORMED', 'IN_PROGRESS']);

function questionTimeLabel(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function decorateQuestion(question, activity) {
  const answer = question.answer
    ? {
        ...question.answer,
        responderName: question.answer.responder && question.answer.responder.nickname || '发起者'
      }
    : null;
  return {
    ...question,
    askerName: question.asker && question.asker.nickname || '匿名参与者',
    createdLabel: questionTimeLabel(question.createdAt),
    answer,
    canAnswer: activity.viewerRole === 'owner'
      && !answer
      && QA_ANSWER_STATUSES.includes(activity.status)
  };
}

function initialQaState() {
  return {
    loading: false,
    error: '',
    items: [],
    previewItems: [],
    nextCursor: null,
    expanded: false,
    canAsk: false
  };
}

function initialQaModal() {
  return {
    visible: false,
    type: 'ask',
    targetId: '',
    targetContent: '',
    content: '',
    submitting: false
  };
}

function rowsFor(activity) {
  if (activity.type === 'ride') {
    return [
      { label: '路线', value: `${activity.typeData.origin} → ${activity.typeData.destination}` },
      { label: '费用', value: FEE_LABELS[activity.typeData.feeType] || '不涉及费用' },
      { label: '行李', value: LUGGAGE_LABELS[activity.typeData.luggageRule] || '请与发起者确认' }
    ];
  }
  if (activity.type === 'product') {
    return [
      { label: '商品', value: activity.typeData.productName },
      { label: '目标数量', value: `${activity.typeData.targetQuantity} 件` },
      { label: '预估单价', value: activity.typeData.unitPriceRange },
      { label: '购买渠道', value: activity.typeData.shoppingChannel },
      { label: '交付方式', value: DELIVERY_LABELS[activity.typeData.deliveryMode] || '成团后协商' }
    ];
  }
  return [
    { label: '活动类别', value: activity.typeData.category },
    { label: '费用方式', value: COST_LABELS[activity.typeData.costMode] || '费用自理' },
    { label: '活动强度', value: LEVEL_LABELS[activity.typeData.level] || '新手友好' },
    { label: '装备要求', value: activity.typeData.equipment || '无特殊要求' }
  ];
}

Page({
  data: {
    id: '',
    loading: true,
    error: '',
    errorCode: '',
    activity: null,
    detailRows: [],
    note: '',
    consent: true,
    pending: false,
    qa: initialQaState(),
    qaModal: initialQaModal()
  },

  onLoad(options = {}) {
    this.setData({ id: decodeActivityId(options.id) });
    if (typeof wx.showShareMenu === 'function') {
      try {
        wx.showShareMenu({ menus: ['shareAppMessage'] });
      } catch (error) {
        // The page-level share button remains available on supported clients.
      }
    }
  },

  onShow() {
    return this.loadDetail();
  },

  onUnload() {
    this._loadSeq = (this._loadSeq || 0) + 1;
    this._qaLoadSeq = (this._qaLoadSeq || 0) + 1;
  },

  async loadDetail() {
    const loadSeq = (this._loadSeq = (this._loadSeq || 0) + 1);
    this._qaLoadSeq = (this._qaLoadSeq || 0) + 1;
    if (!this.data.id) {
      this.setData({
        loading: false,
        activity: null,
        detailRows: [],
        qa: initialQaState(),
        ...resolveDetailError({ code: 'NOT_FOUND' })
      });
      return;
    }
    this.setData({
      loading: true,
      error: '',
      errorCode: '',
      activity: null,
      detailRows: [],
      qa: initialQaState(),
      qaModal: initialQaModal()
    });
    try {
      const result = await activityService.detail(this.data.id);
      if (loadSeq !== this._loadSeq) return;
      const activity = decorateActivity(result.activity);
      this.setData({ activity, detailRows: rowsFor(activity), loading: false });
      this.loadQuestions(activity);
    } catch (error) {
      if (loadSeq !== this._loadSeq) return;
      this.setData({ loading: false, ...resolveDetailError(error) });
    }
  },

  async loadQuestions(activity = this.data.activity) {
    const loadSeq = (this._qaLoadSeq = (this._qaLoadSeq || 0) + 1);
    if (!activity || !activity.id) {
      this.setData({ qa: initialQaState() });
      return;
    }
    const expanded = this.data.qa && this.data.qa.expanded === true;
    this.setData({
      qa: {
        ...initialQaState(),
        loading: true,
        expanded,
        canAsk: QA_ASK_STATUSES.includes(activity.status)
      }
    });
    try {
      const result = await activityService.qaList(activity.id, null, QA_PAGE_LIMIT);
      if (loadSeq !== this._qaLoadSeq) return;
      const items = (result.items || []).map((item) => decorateQuestion(item, activity));
      this.setData({
        qa: {
          loading: false,
          error: '',
          items,
          previewItems: expanded ? items : items.slice(0, QA_PREVIEW_LIMIT),
          nextCursor: result.nextCursor || null,
          expanded,
          canAsk: QA_ASK_STATUSES.includes(activity.status)
        }
      });
    } catch (error) {
      if (loadSeq !== this._qaLoadSeq) return;
      this.setData({
        qa: {
          ...initialQaState(),
          error: '公开问答暂时无法加载',
          expanded,
          canAsk: QA_ASK_STATUSES.includes(activity.status)
        }
      });
    }
  },

  handleRetryQuestions() {
    return this.loadQuestions(this.data.activity);
  },

  handleToggleQuestions() {
    const expanded = !this.data.qa.expanded;
    this.setData({
      qa: {
        ...this.data.qa,
        expanded,
        previewItems: expanded ? this.data.qa.items : this.data.qa.items.slice(0, QA_PREVIEW_LIMIT)
      }
    });
  },

  handleOpenAsk() {
    if (!this.data.qa.canAsk) return;
    this.setData({ qaModal: { ...initialQaModal(), visible: true, type: 'ask' } });
  },

  handleOpenAnswer(event) {
    const dataset = event && event.currentTarget && event.currentTarget.dataset || {};
    if (!dataset.id) return;
    this.setData({
      qaModal: {
        ...initialQaModal(),
        visible: true,
        type: 'answer',
        targetId: dataset.id,
        targetContent: dataset.content || ''
      }
    });
  },

  handleCloseQuestion() {
    if (this.data.qaModal.submitting) return;
    this.setData({ qaModal: initialQaModal() });
  },

  handleQuestionInput(event) {
    this.setData({
      qaModal: {
        ...this.data.qaModal,
        content: event.detail.value
      }
    });
  },

  async handleSubmitQuestion() {
    const modal = this.data.qaModal;
    if (!modal.visible || modal.submitting) return;
    const content = String(modal.content || '').trim();
    const minimum = modal.type === 'ask' ? 2 : 1;
    if (content.length < minimum) {
      wx.showToast({ title: modal.type === 'ask' ? '请至少输入2个字' : '请输入回答内容', icon: 'none' });
      return;
    }
    this.setData({ qaModal: { ...modal, content, submitting: true } });
    try {
      await userService.login();
      if (modal.type === 'answer') {
        await activityService.answerQuestion(this.data.id, modal.targetId, content);
      } else {
        await activityService.askQuestion(this.data.id, content);
      }
      this.setData({ qaModal: initialQaModal() });
      wx.showToast({ title: modal.type === 'answer' ? '回答已发布' : '问题已发布', icon: 'success' });
      await this.loadQuestions(this.data.activity);
    } catch (error) {
      if (!error.handled) wx.showToast({ title: error.message || '提交失败，请重试', icon: 'none' });
    } finally {
      if (this.data.qaModal.visible) {
        this.setData({ qaModal: { ...this.data.qaModal, submitting: false } });
      }
    }
  },

  preventTouchMove() {},

  handleGoDiscover() {
    wx.switchTab({ url: '/pages/discover/index' });
  },

  onShareAppMessage() {
    const { activity, errorCode, id, loading } = this.data;
    if (loading || errorCode || !activity || !id) return { ...DISCOVER_SHARE };
    const title = typeof activity.title === 'string' && activity.title.trim()
      ? activity.title.trim()
      : '精彩组团活动';
    return {
      title: `拼吧｜${title}`,
      path: `/subpackages/activity/detail/index?id=${encodeURIComponent(id)}`
    };
  },

  handleNote(event) {
    this.setData({ note: event.detail.value });
  },

  handleConsent(event) {
    this.setData({ consent: event.detail.value.includes('consent') });
  },

  async handleApply() {
    if (this.data.pending || !this.data.consent) return;
    this.setData({ pending: true });
    try {
      const user = await userService.login();
      if (!user.profile || !user.profile.adultConfirmed) {
        wx.navigateTo({ url: `/subpackages/profile/edit/index?next=${encodeURIComponent(`/subpackages/activity/detail/index?id=${this.data.id}`)}` });
        return;
      }
      await subscriptionService.requestStatusUpdates();
      await activityService.apply(this.data.id, this.data.note.trim());
      wx.showToast({ title: '申请已提交', icon: 'success' });
      await this.loadDetail();
    } catch (error) {
      if (!error.handled) wx.showToast({ title: error.message || '申请失败', icon: 'none' });
    } finally {
      this.setData({ pending: false });
    }
  },

  handleWithdraw() {
    const application = this.data.activity && this.data.activity.viewerApplication;
    if (!application || this.data.pending) return;
    wx.showModal({
      title: '撤回申请？',
      content: '撤回后如仍想加入，需要重新提交申请。',
      confirmText: '撤回',
      success: async (result) => {
        if (!result.confirm) return;
        this.setData({ pending: true });
        try {
          await activityService.withdraw(application.id);
          wx.showToast({ title: '申请已撤回', icon: 'success' });
          await this.loadDetail();
        } catch (error) {
          if (!error.handled) wx.showToast({ title: error.message || '撤回失败', icon: 'none' });
        } finally {
          this.setData({ pending: false });
        }
      }
    });
  },

  handleManage() {
    wx.navigateTo({ url: `/subpackages/activity/manage/index?id=${this.data.id}` });
  },

  handleGroup() {
    wx.navigateTo({ url: `/subpackages/activity/group/index?id=${this.data.id}` });
  },

  handleReport() {
    wx.navigateTo({ url: `/subpackages/safety/report/index?type=activity&id=${this.data.id}` });
  }
});
