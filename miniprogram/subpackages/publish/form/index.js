'use strict';

const activityService = require('../../../services/activity');
const subscriptionService = require('../../../services/subscription');
const { combineLocal } = require('../../../utils/date');
const { MEMBER_LUGGAGE_OPTIONS, MEMBER_LUGGAGE_TYPES } = require('../../../config/luggage');
const { PHONE_REGION_OPTIONS, phoneDigits, phoneOption, isPhoneValid, buildPhone } = require('../../../utils/phone');
const { AVATAR_PATHS, profileAvatarPath } = require('../../../utils/passenger-avatar');
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

const DEFAULT_RIDE_FEE = 'SHARED_COST';
const PICKUP_WINDOW_MS = 60 * 60 * 1000;
const MIN_SCHEDULE_LEAD_MS = 5 * 60 * 1000;
const MAX_SCHEDULE_MS = 7 * 24 * 60 * 60 * 1000;
const PICKUP_TIME_OPTIONS = Object.freeze(
  Array.from({ length: 96 }, (_, index) => {
    const hours = String(Math.floor(index / 4)).padStart(2, '0');
    const minutes = String((index % 4) * 15).padStart(2, '0');
    return `${hours}:${minutes}`;
  })
);

function initialForm() {
  return {
    type: 'ride',
    description: '',
    city: PILOT_CITY,
    district: PILOT_DISTRICTS[0],
    placeLabel: '',
    startDate: '',
    startTime: '',
    targetMembers: 7,
    minPassengers: 7,
    maxPassengers: 7,
    phoneRegion: '+853',
    phoneNumber: '',
    rules: '',
    routeId: '',
    origin: '',
    destination: '',
    feeType: DEFAULT_RIDE_FEE,
    luggageType: ''
  };
}

function createPublisherSlots(gender) {
  return Array.from({ length: 7 }, (_, index) => ({
    id: index + 1,
    src: index === 0 ? profileAvatarPath(gender) : AVATAR_PATHS.EMPTY,
    empty: index !== 0
  }));
}

function formatClock(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function pickupWindowLabel(dateValue, timeValue) {
  if (!dateValue || !timeValue) return '选择后自动形成 60 分钟时间窗';
  const startsAt = new Date(combineLocal(dateValue, timeValue));
  if (!Number.isFinite(startsAt.getTime())) return '选择后自动形成 60 分钟时间窗';
  const endsAt = new Date(startsAt.getTime() + PICKUP_WINDOW_MS);
  const nextDay = endsAt.getDate() !== startsAt.getDate();
  return `${formatClock(startsAt)}–${nextDay ? '次日 ' : ''}${formatClock(endsAt)}`;
}

function buildRideTitle(route) {
  return `${route.code}｜${route.origin}→${route.destination}`;
}

function rideDeadlineAt(startsAt) {
  const startsAtMs = Date.parse(startsAt);
  return new Date(startsAtMs - 1000).toISOString();
}

function safeRideStartsAt(dateValue, timeValue) {
  try {
    const startsAt = combineLocal(dateValue, timeValue);
    return Number.isFinite(Date.parse(startsAt)) ? startsAt : '';
  } catch (error) {
    return '';
  }
}

function presenceReady(data) {
  const form = data.form;
  return Boolean(
    getRideRoute(form.routeId)
      && form.startDate
      && form.startTime
      && form.luggageType
      && form.phoneNumber
      && data.safetyAgreed
  );
}

Page({
  data: {
    type: 'ride',
    form: initialForm(),
    routeOptions: RIDE_ROUTES,
    routeColumns: rideRoutePickerState(RIDE_ROUTES[0].id).columns,
    routeIndexes: rideRoutePickerState(RIDE_ROUTES[0].id).indexes,
    routeSelected: false,
    routeOriginLabel: '选择起点',
    routeDestinationLabel: '选择终点',
    routeOriginId: '',
    routeDestinationId: '',
    pickupTimeOptions: PICKUP_TIME_OPTIONS,
    pickupTimeIndex: 0,
    pickupWindowLabel: '选择后自动形成 60 分钟时间窗',
    publisherSlots: createPublisherSlots(null),
    luggageOptions: MEMBER_LUGGAGE_OPTIONS,
    phoneRegionOptions: PHONE_REGION_OPTIONS,
    phoneRegionIndex: 0,
    phonePlaceholder: PHONE_REGION_OPTIONS[0].placeholder,
    safetyAgreed: false,
    submitReady: false,
    submitting: false,
    errorMessage: '',
    errorField: '',
    submissionKey: ''
  },

  onLoad() {
    const app = typeof getApp === 'function' ? getApp() : null;
    const profile = app && app.globalData && app.globalData.user && app.globalData.user.profile;
    const form = initialForm();
    const routeState = rideRoutePickerState(RIDE_ROUTES[0].id);
    this.draftKey = 'pinba_publish_draft_ride';
    this.setData({
      form,
      routeColumns: routeState.columns,
      routeIndexes: routeState.indexes,
      publisherSlots: createPublisherSlots(profile && profile.gender),
      submissionKey: `publish_ride_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    });
    const draft = wx.getStorageSync(this.draftKey);
    if (draft && draft.form) {
      wx.showModal({
        title: '继续上次填写？',
        content: '检测到尚未完成的拼车草稿，联系电话不会从草稿恢复。',
        confirmText: '继续填写',
        cancelText: '重新开始',
        success: (result) => {
          if (result.confirm) this.restoreDraft(draft);
          else wx.removeStorageSync(this.draftKey);
        }
      });
    }
  },

  onHide() {
    if (!this.data.submitting) this.saveDraft();
    if (this.data.form.phoneNumber) this.setData({ 'form.phoneNumber': '', submitReady: false });
  },

  onUnload() {
    if (!this.data.submitting) this.saveDraft();
    this.data.form.phoneNumber = '';
  },

  restoreDraft(draft) {
    const form = { ...initialForm(), ...draft.form, type: 'ride', phoneNumber: '' };
    const route = getRideRoute(form.routeId);
    const routeState = rideRoutePickerState(route && route.id);
    const pickupTimeIndex = Math.max(PICKUP_TIME_OPTIONS.indexOf(form.startTime), 0);
    this.setData({
      form,
      safetyAgreed: draft.safetyAgreed === true,
      routeColumns: routeState.columns,
      routeIndexes: routeState.indexes,
      routeSelected: Boolean(route),
      routeOriginLabel: route ? route.origin : '选择起点',
      routeDestinationLabel: route ? route.destination : '选择终点',
      routeOriginId: route ? route.originId : '',
      routeDestinationId: route ? route.destinationId : '',
      pickupTimeIndex,
      pickupWindowLabel: pickupWindowLabel(form.startDate, form.startTime),
      phoneRegionIndex: Math.max(PHONE_REGION_OPTIONS.findIndex((item) => item.code === form.phoneRegion), 0),
      phonePlaceholder: phoneOption(form.phoneRegion).placeholder,
      submitReady: false
    });
  },

  saveDraft() {
    if (!this.draftKey) return;
    const { phoneNumber, ...safeForm } = this.data.form;
    wx.setStorageSync(this.draftKey, {
      form: safeForm,
      safetyAgreed: this.data.safetyAgreed,
      savedAt: Date.now()
    });
  },

  updateState(patch, fields = []) {
    const shouldClearError = fields.includes(this.data.errorField);
    this.setData({
      ...patch,
      ...(shouldClearError ? { errorMessage: '', errorField: '' } : {})
    }, () => this.refreshSubmitReady());
  },

  refreshSubmitReady() {
    const submitReady = presenceReady(this.data);
    if (submitReady !== this.data.submitReady) this.setData({ submitReady });
  },

  handleInput(event) {
    const field = event.currentTarget.dataset.field;
    this.updateState({ [`form.${field}`]: event.detail.value }, [field]);
  },

  handlePhoneInput(event) {
    this.updateState({ 'form.phoneNumber': phoneDigits(event.detail.value) }, ['phone']);
  },

  handlePhoneRegion(event) {
    const index = Math.min(Math.max(Number(event.detail.value) || 0, 0), PHONE_REGION_OPTIONS.length - 1);
    const option = PHONE_REGION_OPTIONS[index];
    this.updateState({
      phoneRegionIndex: index,
      phonePlaceholder: option.placeholder,
      'form.phoneRegion': option.code
    }, ['phone']);
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
    this.updateState({
      routeColumns: routeState.columns,
      routeIndexes: routeState.indexes,
      routeSelected: true,
      routeOriginLabel: route.origin,
      routeDestinationLabel: route.destination,
      routeOriginId: route.originId,
      routeDestinationId: route.destinationId,
      'form.routeId': route.id,
      'form.origin': route.origin,
      'form.destination': route.destination,
      'form.placeLabel': `${route.origin} → ${route.destination}`
    }, ['route']);
  },

  handleLuggageSelect(event) {
    const luggageType = event.currentTarget.dataset.luggageType;
    if (!MEMBER_LUGGAGE_TYPES.includes(luggageType)) return;
    this.updateState({ 'form.luggageType': luggageType }, ['luggage']);
  },

  showLuggageHelp() {
    wx.showModal({
      title: '行李大小说明',
      content: '无行李：仅随身小包或普通双肩书包。\n小行李：20 吋及以下登机箱或手提行李袋。\n大行李：24 吋及以上托运箱、超大乐器等。',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  handleDate(event) {
    const startDate = event.detail.value;
    this.updateState({
      'form.startDate': startDate,
      pickupWindowLabel: pickupWindowLabel(startDate, this.data.form.startTime)
    }, ['time']);
  },

  handlePickupTime(event) {
    const index = Math.min(Math.max(Number(event.detail.value) || 0, 0), PICKUP_TIME_OPTIONS.length - 1);
    const startTime = PICKUP_TIME_OPTIONS[index];
    this.updateState({
      pickupTimeIndex: index,
      'form.startTime': startTime,
      pickupWindowLabel: pickupWindowLabel(this.data.form.startDate, startTime)
    }, ['time']);
  },

  handleSafety(event) {
    this.updateState({ safetyAgreed: event.detail.value.includes('agreed') }, ['safety']);
  },

  validateForm() {
    const form = this.data.form;
    if (!getRideRoute(form.routeId)) return { field: 'route', message: '请选择固定起点与终点' };
    if (!form.startDate || !form.startTime) return { field: 'time', message: '请选择出发日期与时间窗' };
    const now = Date.now();
    const startsAt = safeRideStartsAt(form.startDate, form.startTime);
    const startsAtMs = Date.parse(startsAt);
    if (!Number.isFinite(startsAtMs)) return { field: 'time', message: '出发时间无效，请重新选择' };
    if (startsAtMs <= now + MIN_SCHEDULE_LEAD_MS) return { field: 'time', message: '出发时间需至少晚于当前时间 5 分钟' };
    if (startsAtMs - now > MAX_SCHEDULE_MS) return { field: 'time', message: '出发时间最多可选择未来 7 天' };
    if (new Date(startsAtMs).getMinutes() % 15 !== 0) return { field: 'time', message: '接车时间请按 15 分钟选择' };
    if (!form.luggageType) return { field: 'luggage', message: '请先选择我的行李' };
    if (!isPhoneValid(form.phoneRegion, form.phoneNumber)) return { field: 'phone', message: '请输入正确的本人联系电话' };
    if (!this.data.safetyAgreed) return { field: 'safety', message: '请阅读并同意安全规则' };
    return null;
  },

  showValidationError(error) {
    this.setData({ errorMessage: error.message, errorField: error.field });
    wx.pageScrollTo({
      selector: `#field-${error.field}`,
      offsetTop: -20,
      duration: 200,
      fail: () => wx.pageScrollTo({ scrollTop: 0, duration: 200 })
    });
  },

  buildPayload() {
    const form = this.data.form;
    const route = getRideRoute(form.routeId);
    const startsAt = safeRideStartsAt(form.startDate, form.startTime);
    const common = {
      type: 'ride',
      title: buildRideTitle(route),
      description: form.description.trim(),
      city: form.city,
      district: form.district,
      placeLabel: `${route.origin} → ${route.destination}`,
      startsAt,
      deadlineAt: rideDeadlineAt(startsAt),
      targetMembers: 7,
      contactInfo: buildPhone(form.phoneRegion, form.phoneNumber),
      rules: form.rules.trim(),
      luggageType: form.luggageType,
      typeData: {
        routeId: route.id,
        pickupWindowEnd: new Date(Date.parse(startsAt) + PICKUP_WINDOW_MS).toISOString(),
        feeType: form.feeType
      }
    };
    common.minPassengers = 7;
    common.maxPassengers = 7;
    return common;
  },

  async handleSubmit() {
    if (this.data.submitting) return;
    const validationError = this.validateForm();
    if (validationError) {
      this.showValidationError(validationError);
      return;
    }
    this.setData({ submitting: true, errorMessage: '', errorField: '', submitReady: false });
    try {
      await subscriptionService.requestStatusUpdates();
      const result = await activityService.create(this.buildPayload(), this.data.submissionKey);
      wx.removeStorageSync(this.draftKey);
      this.setData({ 'form.phoneNumber': '' });
      wx.showToast({ title: '发布成功', icon: 'success' });
      setTimeout(() => {
        wx.redirectTo({ url: `/subpackages/activity/detail/index?id=${result.activity.id}` });
      }, 500);
    } catch (error) {
      this.setData({
        errorMessage: error.handled ? '账号暂时无法使用' : error.message || '发布失败，请检查后重试',
        errorField: 'submit',
        submitting: false
      }, () => this.refreshSubmitReady());
      this.saveDraft();
    }
  }
});
