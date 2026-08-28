'use strict';

const activityService = require('../../../services/activity');
const subscriptionService = require('../../../services/subscription');
const { futureLocal, combineLocal } = require('../../../utils/date');
const { TYPE_META } = require('../../../utils/display');
const {
  PILOT_CITY,
  PILOT_DISTRICTS,
  RIDE_ROUTES,
  getRideRoute,
  rideRoutePickerState,
  rideRouteFromIndexes,
  routesFromOrigin,
  RIDE_ROUTE_ORIGINS
} = require('../../../config/locations');

const RIDE_FEES = [
  { value: 'FREE', label: '免费互助' },
  { value: 'SHARED_COST', label: '合理成本均摊' },
  { value: 'NO_COST', label: '不涉及费用' }
];
const LUGGAGE_RULES = [
  { value: 'NO_LARGE', label: '无大件行李' },
  { value: 'ONE_SMALL', label: '每人一件小行李' },
  { value: 'TRUNK_OK', label: '可放后备箱' }
];
const DELIVERY_MODES = [
  { value: 'FACE_TO_FACE', label: '当面验货交付' },
  { value: 'PICKUP', label: '指定商圈自提' },
  { value: 'ARRANGE_AFTER_FORMED', label: '成团后协商' }
];
const BUDDY_COSTS = [
  { value: 'AA', label: 'AA制' },
  { value: 'SELF_PAY', label: '费用自理' },
  { value: 'HOST_TREATS', label: '发起者请客' }
];
const BUDDY_LEVELS = [
  { value: 'BEGINNER', label: '新手友好' },
  { value: 'INTERMEDIATE', label: '需一定基础' },
  { value: 'ADVANCED', label: '进阶专业' }
];

function initialForm(type) {
  const starts = futureLocal(30);
  const deadline = futureLocal(20);
  const startMinute = Number(starts.time.split(':')[1]);
  const alignedMinute = Math.ceil(startMinute / 15) * 15;
  const alignedStarts = new Date(combineLocal(starts.date, starts.time));
  alignedStarts.setMinutes(alignedStarts.getMinutes() + alignedMinute - startMinute, 0, 0);
  starts.date = `${alignedStarts.getFullYear()}-${String(alignedStarts.getMonth() + 1).padStart(2, '0')}-${String(alignedStarts.getDate()).padStart(2, '0')}`;
  starts.time = `${String(alignedStarts.getHours()).padStart(2, '0')}:${String(alignedStarts.getMinutes()).padStart(2, '0')}`;
  const defaultRoute = RIDE_ROUTES[0];
  return {
    type,
    title: '',
    description: '',
    city: PILOT_CITY,
    district: PILOT_DISTRICTS[0],
    placeLabel: `${defaultRoute.origin} → ${defaultRoute.destination}`,
    startDate: starts.date,
    startTime: starts.time,
    deadlineDate: deadline.date,
    deadlineTime: deadline.time,
    targetMembers: 7,
    minPassengers: 7,
    maxPassengers: 7,
    contactInfo: '',
    rules: '',
    routeId: defaultRoute.id,
    origin: defaultRoute.origin,
    destination: defaultRoute.destination,
    feeType: RIDE_FEES[1].value,
    luggageRule: LUGGAGE_RULES[1].value,
    productName: '',
    targetQuantity: 2,
    unitPriceRange: '',
    shoppingChannel: '',
    deliveryMode: DELIVERY_MODES[0].value,
    category: '运动',
    costMode: BUDDY_COSTS[0].value,
    level: BUDDY_LEVELS[0].value,
    equipment: ''
  };
}

Page({
  data: {
    type: 'ride',
    typeLabel: '拼车',
    typeColor: '#3478F6',
    step: 1,
    form: initialForm('ride'),
    routeOptions: RIDE_ROUTES,
    routeIndex: 0,
    routeColumns: rideRoutePickerState(RIDE_ROUTES[0].id).columns,
    routeIndexes: rideRoutePickerState(RIDE_ROUTES[0].id).indexes,
    routeLabel: `${RIDE_ROUTES[0].origin} → ${RIDE_ROUTES[0].destination}（${RIDE_ROUTES[0].code}）`,
    districtOptions: PILOT_DISTRICTS,
    districtIndex: 0,
    feeOptions: RIDE_FEES,
    feeIndex: 1,
    luggageOptions: LUGGAGE_RULES,
    luggageIndex: 1,
    deliveryOptions: DELIVERY_MODES,
    deliveryIndex: 0,
    buddyCostOptions: BUDDY_COSTS,
    buddyCostIndex: 0,
    buddyLevelOptions: BUDDY_LEVELS,
    buddyLevelIndex: 0,
    safetyAgreed: false,
    submitting: false,
    errorMessage: '',
    submissionKey: ''
  },

  onLoad(options) {
    const type = 'ride';
    const meta = TYPE_META[type];
    const form = initialForm(type);
    const routeState = rideRoutePickerState(form.routeId);
    this.draftKey = `pinba_publish_draft_${type}`;
    this.setData({
      type,
      typeLabel: meta.label,
      typeColor: meta.color,
      form,
      routeColumns: routeState.columns,
      routeIndexes: routeState.indexes,
      routeLabel: `${routeState.route.origin} → ${routeState.route.destination}（${routeState.route.code}）`,
      submissionKey: `publish_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    });
    const draft = wx.getStorageSync(this.draftKey);
    if (draft && draft.form) {
      wx.showModal({
        title: '继续上次填写？',
        content: '检测到这个类型有未完成的草稿。',
        confirmText: '继续填写',
        cancelText: '重新开始',
        success: (result) => {
          if (result.confirm) this.restoreDraft(draft);
          else wx.removeStorageSync(this.draftKey);
        }
      });
    }
  },

  onUnload() {
    if (!this.data.submitting) this.saveDraft();
  },

  restoreDraft(draft) {
    const form = { ...initialForm(this.data.type), ...draft.form, type: this.data.type };
    const routeState = rideRoutePickerState(form.routeId);
    this.setData({
      form,
      step: draft.step || 1,
      safetyAgreed: draft.safetyAgreed === true,
      routeIndex: Math.max(RIDE_ROUTES.findIndex((item) => item.id === form.routeId), 0),
      routeColumns: routeState.columns,
      routeIndexes: routeState.indexes,
      routeLabel: `${routeState.route.origin} → ${routeState.route.destination}（${routeState.route.code}）`,
      districtIndex: Math.max(PILOT_DISTRICTS.indexOf(form.district), 0),
      feeIndex: Math.max(RIDE_FEES.findIndex((item) => item.value === form.feeType), 0),
      luggageIndex: Math.max(LUGGAGE_RULES.findIndex((item) => item.value === form.luggageRule), 0),
      deliveryIndex: Math.max(DELIVERY_MODES.findIndex((item) => item.value === form.deliveryMode), 0),
      buddyCostIndex: Math.max(BUDDY_COSTS.findIndex((item) => item.value === form.costMode), 0),
      buddyLevelIndex: Math.max(BUDDY_LEVELS.findIndex((item) => item.value === form.level), 0)
    });
  },

  saveDraft() {
    if (!this.draftKey) return;
    wx.setStorageSync(this.draftKey, {
      form: this.data.form,
      step: this.data.step,
      safetyAgreed: this.data.safetyAgreed,
      savedAt: Date.now()
    });
  },

  handleInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: event.detail.value, errorMessage: '' });
  },

  handleDistrict(event) {
    const index = Number(event.detail.value);
    this.setData({ districtIndex: index, 'form.district': PILOT_DISTRICTS[index] });
  },

  handleRouteColumnChange(event) {
    if (Number(event.detail.column) !== 0) return;
    const originIndex = Math.min(Math.max(Number(event.detail.value) || 0, 0), RIDE_ROUTE_ORIGINS.length - 1);
    const destinations = routesFromOrigin(RIDE_ROUTE_ORIGINS[originIndex]).map((route) => route.destination);
    this.setData({
      routeColumns: [RIDE_ROUTE_ORIGINS, destinations],
      routeIndexes: [originIndex, 0]
    });
  },

  handleRoute(event) {
    const route = rideRouteFromIndexes(event.detail.value || this.data.routeIndexes);
    const routeState = rideRoutePickerState(route.id);
    this.setData({
      routeIndex: Math.max(RIDE_ROUTES.findIndex((item) => item.id === route.id), 0),
      routeColumns: routeState.columns,
      routeIndexes: routeState.indexes,
      routeLabel: `${route.origin} → ${route.destination}（${route.code}）`,
      'form.routeId': route.id,
      'form.origin': route.origin,
      'form.destination': route.destination,
      'form.placeLabel': `${route.origin} → ${route.destination}`,
      errorMessage: ''
    });
  },

  handleOption(event) {
    const index = Number(event.detail.value);
    const field = event.currentTarget.dataset.field;
    const source = event.currentTarget.dataset.source;
    const indexField = event.currentTarget.dataset.indexField;
    const options = this.data[source];
    this.setData({ [indexField]: index, [`form.${field}`]: options[index].value });
  },

  handleDate(event) {
    this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value });
  },

  handleSafety(event) {
    this.setData({ safetyAgreed: event.detail.value.includes('agreed') });
  },

  validateStepOne() {
    const form = this.data.form;
    if (!form.title.trim()) return '请填写活动标题';
    if (this.data.type === 'ride' && !getRideRoute(form.routeId)) return '请选择固定路线';
    if (this.data.type === 'product' && (!form.productName.trim() || !form.unitPriceRange.trim())) return '请填写商品名称和预估价格区间';
    if (this.data.type === 'buddy' && !form.category.trim()) return '请填写活动类别';
    const startsAt = combineLocal(form.startDate, form.startTime);
    const deadlineAt = combineLocal(form.deadlineDate, form.deadlineTime);
    if (Date.parse(deadlineAt) <= Date.now()) return '报名截止时间必须晚于当前时间';
    if (Date.parse(startsAt) <= Date.parse(deadlineAt)) return '活动开始时间必须晚于报名截止时间';
    if (Date.parse(startsAt) - Date.now() > 7 * 24 * 60 * 60 * 1000) return '活动开始时间不能超过7天';
    if (this.data.type === 'ride' && new Date(startsAt).getMinutes() % 15 !== 0) return '期望时间请按 15 分钟选择';
    return '';
  },

  handleNext() {
    const errorMessage = this.validateStepOne();
    if (errorMessage) {
      this.setData({ errorMessage });
      wx.pageScrollTo({ scrollTop: 0, duration: 200 });
      return;
    }
    this.setData({ step: 2, errorMessage: '' });
    this.saveDraft();
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
  },

  handleBack() {
    this.setData({ step: 1, errorMessage: '' });
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
  },

  buildPayload() {
    const form = this.data.form;
    const common = {
      type: this.data.type,
      title: form.title.trim(),
      description: form.description.trim(),
      city: form.city,
      district: form.district,
      placeLabel: form.placeLabel.trim(),
      startsAt: combineLocal(form.startDate, form.startTime),
      deadlineAt: combineLocal(form.deadlineDate, form.deadlineTime),
      targetMembers: this.data.type === 'ride' ? 7 : Number(form.targetMembers),
      contactInfo: form.contactInfo.trim(),
      rules: form.rules.trim()
    };
    if (this.data.type === 'ride') {
      const startsAt = Date.parse(common.startsAt);
      common.minPassengers = 7;
      common.maxPassengers = 7;
      common.typeData = {
        routeId: form.routeId,
        pickupWindowEnd: new Date(startsAt + 60 * 60 * 1000).toISOString(),
        feeType: form.feeType,
        luggageRule: form.luggageRule
      };
    }
    if (this.data.type === 'product') {
      common.typeData = {
        productName: form.productName.trim(), targetQuantity: Number(form.targetQuantity),
        unitPriceRange: form.unitPriceRange.trim(), shoppingChannel: form.shoppingChannel.trim(), deliveryMode: form.deliveryMode
      };
    }
    if (this.data.type === 'buddy') {
      common.typeData = { category: form.category.trim(), costMode: form.costMode, level: form.level, equipment: form.equipment.trim() };
    }
    return common;
  },

  async handleSubmit() {
    if (this.data.submitting) return;
    if (!this.data.form.contactInfo.trim()) return this.setData({ errorMessage: '请填写成团后联系方式' });
    if (!this.data.safetyAgreed) return this.setData({ errorMessage: '请阅读并同意安全规则' });
    this.setData({ submitting: true, errorMessage: '' });
    try {
      await subscriptionService.requestStatusUpdates();
      const result = await activityService.create(this.buildPayload(), this.data.submissionKey);
      wx.removeStorageSync(this.draftKey);
      wx.showToast({ title: '发布成功', icon: 'success' });
      setTimeout(() => {
        wx.redirectTo({ url: `/subpackages/activity/detail/index?id=${result.activity.id}` });
      }, 500);
    } catch (error) {
      this.setData({
        errorMessage: error.handled ? '账号暂时无法使用' : error.message || '发布失败，请检查后重试',
        submitting: false
      });
      wx.pageScrollTo({ scrollTop: 0, duration: 200 });
      this.saveDraft();
    }
  }
});
