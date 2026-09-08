'use strict';

const activityService = require('../../../services/activity');
const subscriptionService = require('../../../services/subscription');
const { combineLocal } = require('../../../utils/date');
const { calculateContentTopInset } = require('../../../utils/navigation-layout');
const { PILOT_CITY, PILOT_DISTRICTS } = require('../../../config/locations');

const TYPES = Object.freeze({
  companion: { title: '发布拼同行', subtitle: '找同路伙伴，一起商量合规出行方式', tone: 'companion', icon: '../../../assets/images/publish/pin_food.png' },
  sport: { title: '发布拼运动', subtitle: '约球、跑步或组队，找到合适的运动搭子', tone: 'sport', icon: '../../../assets/images/publish/pin_food.png' },
  food: { title: ' 发布拼饭桌 ', subtitle: '发起拼饭桌 \n 一起探索附近好味道!', tone: 'food', icon: '../../../assets/images/publish/pin_food.png' }
});

const CUISINE_IMAGES = Object.freeze({
  '粤菜': '../../../assets/images/publish/yuecai.png',
  '火锅': '../../../assets/images/publish/pin_htht.jpg',
  '川菜': '../../../assets/images/publish/pin_htht.jpg',
  '湘菜': '../../../assets/images/publish/pin_htht.jpg',
  '鲁菜': '../../../assets/images/publish/pin_htht.jpg',
  '苏菜': '../../../assets/images/publish/pin_htht.jpg',
  '浙菜': '../../../assets/images/publish/pin_htht.jpg',
  '闽菜': '../../../assets/images/publish/pin_htht.jpg',
  '徽菜': '../../../assets/images/publish/pin_htht.jpg',
  '东北菜': '../../../assets/images/publish/pin_htht.jpg',
  '西北菜': '../../../assets/images/publish/pin_htht.jpg',
  '新疆菜': '../../../assets/images/publish/pin_htht.jpg',
  '烧烤': '../../../assets/images/publish/pin_htht.jpg',
  '自助餐': '../../../assets/images/publish/pin_htht.jpg',
  '日料': '../../../assets/images/publish/pin_htht.jpg',
  '韩料': '../../../assets/images/publish/pin_htht.jpg',
  '西餐': '../../../assets/images/publish/pin_htht.jpg',
  '东南亚菜': '../../../assets/images/publish/pin_htht.jpg',
  '轻食': '../../../assets/images/publish/pin_htht.jpg',
  '家常菜': '../../../assets/images/publish/pin_htht.jpg'
});
const TIME_OPTIONS = Object.freeze(Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`));
const COMMON_FORM_FIELDS = Object.freeze(['title', 'description', 'rules', 'placeLabel', 'startDate', 'startTime', 'minMembers', 'maxMembers']);
const TYPE_FORM_FIELDS = Object.freeze({
  companion: ['originLabel', 'destinationLabel', 'timeFlexibility', 'transportPreference', 'luggageType'],
  sport: ['sportType', 'venue', 'level', 'intensity', 'equipment'],
  food: ['venue', 'cuisine', 'budgetRange', 'dietaryNotes', 'genderPreference', 'mbtiPreference', 'paymentMethod']
});

function initialForm(type) {
  return {
    type,
    title: '', description: '', rules: '', placeLabel: '', startDate: '', startTime: '', minMembers: 2, maxMembers: 4,
    originLabel: '', destinationLabel: '', timeFlexibility: 'WITHIN_30_MIN', transportPreference: 'DISCUSS_AFTER_FORMED', luggageType: 'NONE',
    sportType: '', venue: '', level: 'ANY', intensity: 'MEDIUM', equipment: '',
    cuisine: '', budgetRange: '', dietaryNotes: '',
    genderPreference: '', mbtiPreference: '',
    paymentMethod: '', dietaryCustom: ''
  };
}

function cleanFormData(type, source = {}) {
  const initial = initialForm(type);
  const allowed = new Set(['type', ...COMMON_FORM_FIELDS, ...TYPE_FORM_FIELDS[type]]);
  return Object.keys(initial).reduce((result, field) => {
    if (allowed.has(field) && Object.prototype.hasOwnProperty.call(source, field)) result[field] = source[field];
    return result;
  }, { ...initial, type });
}

function safeStartsAt(form) {
  try { return combineLocal(form.startDate, form.startTime); } catch (error) { return ''; }
}

Page({
  data: {
    contentTopInset: 88,
    type: 'companion',
    meta: TYPES.companion,
    typeIcon: TYPES.companion.icon,
    form: initialForm('companion'),
    timeOptions: TIME_OPTIONS,
    timeIndex: 0,
    flexibilityOptions: [{ value: 'ON_TIME', label: '准时' }, { value: 'WITHIN_30_MIN', label: '前后 30 分钟' }, { value: 'WITHIN_60_MIN', label: '前后 60 分钟' }],
    transportOptions: [{ value: 'PUBLIC_TRANSIT', label: '公共交通' }, { value: 'LICENSED_TAXI', label: '正规出租车' }, { value: 'DISCUSS_AFTER_FORMED', label: '成团后商量' }],
    luggageOptions: [{ value: 'NONE', label: '无大件' }, { value: 'SMALL', label: '小行李' }, { value: 'LARGE', label: '大行李' }],
    levelOptions: [{ value: 'ANY', label: '不限' }, { value: 'BEGINNER', label: '新手' }, { value: 'INTERMEDIATE', label: '熟练' }, { value: 'ADVANCED', label: '进阶' }],
    intensityOptions: [{ value: 'LIGHT', label: '轻松' }, { value: 'MEDIUM', label: '适中' }, { value: 'HIGH', label: '高强度' }],
    cuisineOptions: ['粤菜', '火锅', '川菜', '湘菜', '鲁菜', '苏菜', '浙菜', '闽菜', '徽菜', '东北菜', '西北菜', '新疆菜', '烧烤', '自助餐', '日料', '韩料', '西餐', '东南亚菜', '轻食', '家常菜'],
    cuisineIndex: 0,
    cuisineImage: '',
    paymentOptions: ['Fifty Fifty (均摊)', 'Go Dutch (AA)', '真的只是拼张桌'],
    paymentIndex: 0,
    budgetOptions: ['¥20/人以内', '¥20-30/人', '¥30-50/人', '¥50-80/人', '¥80-120/人', '¥120-200/人', '¥200-300/人', '¥300/人以上'],
    budgetIndex: 0,
    dietaryOptions: [{ value: '不吃香菜', label: '不吃香菜' }, { value: '海鲜过敏', label: '海鲜过敏' }, { value: '不能吃辣', label: '不能吃辣' }, { value: '无忌口', label: '无忌口' }],
    genderOptions: ['不限', '男生', '女生', '男女均可'],
    genderIndex: 0,
    mbtiOptions: ['不限', 'INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP', 'ISTJ', 'ISTP', 'ESTJ', 'ESTP', 'ISFJ', 'ISFP', 'ESFJ', 'ESFP'],
    mbtiIndex: 0,
    safetyAgreed: false,
    submitting: false,
    errorMessage: '',
    submissionKey: ''
  },

  onLoad(options = {}) {
    const type = TYPES[options.type] ? options.type : 'companion';
    this.draftKey = `pinba_publish_draft_${type}`;
    const draft = wx.getStorageSync(this.draftKey);
    this.setData({
      contentTopInset: calculateContentTopInset(typeof wx === 'undefined' ? null : wx),
      type,
      meta: TYPES[type],
      typeIcon: TYPES[type].icon,
      form: cleanFormData(type, draft && draft.form),
      safetyAgreed: Boolean(draft && draft.safetyAgreed),
      submissionKey: `publish_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    });
  },

  onHide() { if (!this.data.submitting) this.saveDraft(); },
  onUnload() { if (!this.data.submitting) this.saveDraft(); },

  saveDraft() { wx.setStorageSync(this.draftKey, { form: cleanFormData(this.data.type, this.data.form), safetyAgreed: this.data.safetyAgreed, savedAt: Date.now() }); },

  handleInput(event) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value, errorMessage: '' }); },
  handleDate(event) { this.setData({ 'form.startDate': event.detail.value, errorMessage: '' }); },
  handleTime(event) { const index = Number(event.detail.value) || 0; this.setData({ timeIndex: index, 'form.startTime': TIME_OPTIONS[index], errorMessage: '' }); },
  handleNumber(event) { const field = event.currentTarget.dataset.field; this.setData({ [`form.${field}`]: Number(event.detail.value) || 0, errorMessage: '' }); },
  handleChoice(event) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.currentTarget.dataset.value, errorMessage: '' }); },
  handleSafety(event) { this.setData({ safetyAgreed: event.detail.value.includes('agreed'), errorMessage: '' }); },
  handleCuisine(event) {
    const index = Number(event.detail.value) || 0;
    const cuisine = this.data.cuisineOptions[index];
    this.setData({
      cuisineIndex: index,
      'form.cuisine': cuisine,
      cuisineImage: CUISINE_IMAGES[cuisine] || '',
      errorMessage: ''
    });
  },
  handleBudget(event) { const index = Number(event.detail.value) || 0; this.setData({ budgetIndex: index, 'form.budgetRange': this.data.budgetOptions[index], errorMessage: '' }); },
  handlePayment(event) {
    const index = Number(event.detail.value) || 0;
    const value = this.data.paymentOptions[index];
    this.setData({ paymentIndex: index, 'form.paymentMethod': value, errorMessage: '' });
  },
  handleGenderPreference(event) {
    const index = Number(event.detail.value) || 0;
    const value = this.data.genderOptions[index];
    this.setData({ genderIndex: index, 'form.genderPreference': value === '不限' ? '' : value, errorMessage: '' });
  },
  handleMbtiPreference(event) {
    const index = Number(event.detail.value) || 0;
    const value = this.data.mbtiOptions[index];
    this.setData({ mbtiIndex: index, 'form.mbtiPreference': value === '不限' ? '' : value, errorMessage: '' });
  },
  handleDietaryToggle(event) {
    const value = event.currentTarget.dataset.value;
    const current = this.data.form.dietaryNotes || '';
    let updated;
    if (current.includes(value)) {
      updated = current.split(',').filter(item => item.trim() !== value).join(',').trim();
    } else {
      updated = current ? `${current},${value}` : value;
    }
    this.setData({ 'form.dietaryNotes': updated, errorMessage: '' });
  },
  handleChooseLocation() {
    wx.chooseLocation({
      success: (res) => {
        this.setData({
          'form.venue': res.name || res.address,
          errorMessage: ''
        });
      },
      fail: (err) => {
        console.error('选择位置失败', err);
      }
    });
  },

  handleBack() {
    let pages = [];
    try {
      pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    } catch (error) {
      pages = [];
    }
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 });
      return;
    }
    wx.switchTab({ url: '/pages/publish/index' });
  },

  validateForm() {
    const form = this.data.form;
    if (form.title.trim().length < 2) return '请填写 2—30 个字的活动标题';
    if (!form.startDate || !form.startTime) return '请选择活动时间';
    const startsAt = safeStartsAt(form);
    if (!Number.isFinite(Date.parse(startsAt)) || Date.parse(startsAt) <= Date.now() + 5 * 60 * 1000) return '活动时间需至少晚于当前时间 5 分钟';
    if (form.minMembers < 2 || form.minMembers > 20) return '请设置 2—20 人的总人数要求';
    if (form.maxMembers && form.maxMembers.trim()) {
      const rangeMatch = form.maxMembers.match(/^(\d+)-(\d+)$/);
      if (!rangeMatch) return '人数范围格式应为如：2-5';
      const min = Number(rangeMatch[1]);
      const max = Number(rangeMatch[2]);
      if (min < 2 || max > 20 || min > max) return '人数范围需在 2—20 人之间且格式正确';
      if (min > form.minMembers) return '人数范围最小值不能小于总人数要求';
    }
    if (this.data.type === 'companion' && (!form.originLabel.trim() || !form.destinationLabel.trim())) return '请填写出发地和目的地';
    if (this.data.type === 'sport' && (!form.sportType.trim() || !form.venue.trim())) return '请填写运动项目和活动场地';
    if (this.data.type === 'food' && (!form.venue.trim() || !form.cuisine.trim() || !form.paymentMethod.trim())) return '请填写餐厅、口味和拼桌形式';
    if (this.data.type === 'food' && form.paymentMethod === 'Fifty Fifty (均摊)' && !form.budgetRange.trim()) return '请选择人均预算';
    if (!this.data.safetyAgreed) return '请阅读并同意拼单安全规则';
    return '';
  },

  buildPayload() {
    const form = this.data.form;
    const startsAt = safeStartsAt(form);
    const common = {
      type: this.data.type,
      title: form.title.trim(),
      description: form.description.trim(),
      city: PILOT_CITY,
      district: PILOT_DISTRICTS[0],
      placeLabel: (this.data.type === 'companion' ? `${form.originLabel.trim()} → ${form.destinationLabel.trim()}` : form.venue.trim()),
      startsAt,
      deadlineAt: new Date(Date.parse(startsAt) - 30 * 60 * 1000).toISOString(),
      targetMembers: Number(form.maxMembers),
      minMembers: Number(form.minMembers),
      maxMembers: Number(form.maxMembers),
      rules: form.rules.trim()
    };
    if (this.data.type === 'companion') common.typeData = { originLabel: form.originLabel.trim(), destinationLabel: form.destinationLabel.trim(), timeFlexibility: form.timeFlexibility, transportPreference: form.transportPreference, luggageType: form.luggageType };
    if (this.data.type === 'sport') common.typeData = { sportType: form.sportType.trim(), venue: form.venue.trim(), level: form.level, intensity: form.intensity, equipment: form.equipment.trim() };
    if (this.data.type === 'food') common.typeData = { venue: form.venue.trim(), cuisine: form.cuisine.trim(), budgetRange: form.budgetRange.trim(), dietaryNotes: form.dietaryNotes.trim() };
    return common;
  },

  async handleSubmit() {
    if (this.data.submitting) return;
    const errorMessage = this.validateForm();
    if (errorMessage) return this.setData({ errorMessage });
    this.setData({ submitting: true, errorMessage: '' });
    try {
      await subscriptionService.requestStatusUpdates();
      const result = await activityService.create(this.buildPayload(), this.data.submissionKey);
      wx.removeStorageSync(this.draftKey);
      wx.showToast({ title: '发布成功', icon: 'success' });
      setTimeout(() => wx.redirectTo({ url: `/subpackages/activity/detail/index?id=${result.activity.id}` }), 400);
    } catch (error) {
      this.setData({ submitting: false, errorMessage: error.handled ? '账号暂时无法使用' : error.message || '发布失败，请重试' });
      this.saveDraft();
    }
  }
});
