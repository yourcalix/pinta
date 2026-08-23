'use strict';

const activityService = require('../../../services/activity');
const userService = require('../../../services/user');
const subscriptionService = require('../../../services/subscription');
const { decorateActivity } = require('../../../utils/display');
const { resolveDetailError } = require('../../../utils/detail-error');

const FEE_LABELS = { FREE: '免费互助', SHARED_COST: '合理成本均摊', NO_COST: '不涉及费用' };
const LUGGAGE_LABELS = { NO_LARGE: '无大件行李', ONE_SMALL: '每人一件小行李', TRUNK_OK: '可放后备箱' };
const DELIVERY_LABELS = { FACE_TO_FACE: '当面验货交付', PICKUP: '指定商圈自提', ARRANGE_AFTER_FORMED: '成团后协商' };
const COST_LABELS = { AA: 'AA制', SELF_PAY: '费用自理', HOST_TREATS: '发起者请客' };
const LEVEL_LABELS = { BEGINNER: '新手友好', INTERMEDIATE: '需一定基础', ADVANCED: '进阶专业' };

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
    pending: false
  },

  onLoad(options) {
    this.setData({ id: options.id || '' });
  },

  onShow() {
    if (this.data.id) this.loadDetail();
  },

  onUnload() {
    this._loadSeq = (this._loadSeq || 0) + 1;
  },

  async loadDetail() {
    const loadSeq = (this._loadSeq = (this._loadSeq || 0) + 1);
    this.setData({
      loading: true,
      error: '',
      errorCode: '',
      activity: null,
      detailRows: []
    });
    try {
      const result = await activityService.detail(this.data.id);
      if (loadSeq !== this._loadSeq) return;
      const activity = decorateActivity(result.activity);
      this.setData({ activity, detailRows: rowsFor(activity), loading: false });
    } catch (error) {
      if (loadSeq !== this._loadSeq) return;
      this.setData({ loading: false, ...resolveDetailError(error) });
    }
  },

  handleGoDiscover() {
    wx.switchTab({ url: '/pages/discover/index' });
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
      wx.showToast({ title: error.message || '申请失败', icon: 'none' });
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
          wx.showToast({ title: error.message || '撤回失败', icon: 'none' });
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
