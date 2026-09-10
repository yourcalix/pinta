'use strict';

const activityService = require('../../../services/activity');
const subscriptionService = require('../../../services/subscription');
const { combineLocal } = require('../../../utils/date');
const { calculateContentTopInset } = require('../../../utils/navigation-layout');
const { PILOT_CITY, PILOT_DISTRICTS } = require('../../../config/locations');

const TYPES = Object.freeze({
  companion: { title: '发布拼同行', subtitle: '找同路伙伴，一起商量合规出行方式', tone: 'companion', icon: './assets/food/pin_food.png' },
  sport: { title: '发布拼运动', subtitle: '约球、跑步或组队，找到合适的运动搭子', tone: 'sport', icon: './assets/food/pin_food.png' },
  food: { title: ' 发布拼饭桌 ', subtitle: '发起拼饭桌 \n 一起探索附近好味道!', tone: 'food', icon: './assets/food/pin_food.png' }
});

const CUISINE_IMAGES = Object.freeze({
  '粤菜': './assets/food/yuecai.jpg',
  '火锅': './assets/food/pin_htht.jpg',
  '川菜': './assets/food/pin_htht.jpg',
  '湘菜': './assets/food/pin_htht.jpg',
  '鲁菜': './assets/food/pin_htht.jpg',
  '苏菜': './assets/food/pin_htht.jpg',
  '浙菜': './assets/food/pin_htht.jpg',
  '闽菜': './assets/food/pin_htht.jpg',
  '徽菜': './assets/food/pin_htht.jpg',
  '东北菜': './assets/food/pin_htht.jpg',
  '西北菜': './assets/food/pin_htht.jpg',
  '新疆菜': './assets/food/pin_htht.jpg',
  '烧烤': './assets/food/pin_htht.jpg',
  '自助餐': './assets/food/pin_htht.jpg',
  '日料': './assets/food/pin_htht.jpg',
  '韩料': './assets/food/pin_htht.jpg',
  '西餐': './assets/food/pin_htht.jpg',
  '东南亚菜': './assets/food/pin_htht.jpg',
  '轻食': './assets/food/pin_htht.jpg',
  '家常菜': './assets/food/pin_htht.jpg'
});
const TIME_OPTIONS = Object.freeze(Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`));
const FOOD_PAYMENT_VALUES = Object.freeze({
  'Fifty Fifty (均摊)': 'FIFTY_FIFTY',
  'Go Dutch (AA)': 'GO_DUTCH',
  '真的只是拼张桌': 'TABLE_ONLY'
});
const FOOD_GENDER_VALUES = Object.freeze({ 男生: 'MALE', 女生: 'FEMALE', 男女均可: 'ALL' });
const COMPANION_FORM_ENUMS = Object.freeze({
  timeFlexibility: ['ON_TIME', 'WITHIN_30_MIN', 'WITHIN_60_MIN'],
  transportPreference: ['PUBLIC_TRANSIT', 'LICENSED_TAXI', 'DISCUSS_AFTER_FORMED'],
  luggageType: ['NONE', 'SMALL', 'LARGE'],
  friendGenderPreference: ['', 'ANY', 'FEMALE', 'MALE'],
  mbtiPreference: ['', 'E', 'I', 'ANY'],
  navigationStyle: ['', 'GUIDE', 'FOLLOW', 'LOST_CONFIDENT'],
  travelPace: ['', 'FAST', 'RELAXED', 'SPONTANEOUS'],
  photoHabit: ['', 'FIRST', 'CASUAL', 'NO_CAMERA'],
  silenceComfort: ['', 'CHATTY', 'NATURAL', 'HEADPHONES'],
  garlicPreference: ['', 'OK', 'FRESHEN', 'AVOID'],
  fragrancePreference: ['', 'ANY', 'LIGHT', 'NONE'],
  slippersPreference: ['', 'RELAXED', 'CONTEXT', 'NEAT']
});
const COMMON_FORM_FIELDS = Object.freeze(['title', 'description', 'rules', 'placeLabel', 'startDate', 'startTime', 'minMembers', 'maxMembers', 'meetingPoint']);
const TYPE_FORM_FIELDS = Object.freeze({
  companion: [
    'originLabel', 'destinationLabel', 'timeFlexibility', 'transportPreference', 'luggageType',
    'companionMemberMode', 'companionMinFriends', 'companionMaxFriends',
    'friendGenderPreference', 'mbtiPreference', 'navigationStyle', 'travelPace', 'photoHabit',
    'silenceComfort', 'garlicPreference', 'fragrancePreference', 'slippersPreference'
  ],
  sport: ['sportType', 'venue', 'level', 'intensity', 'equipment'],
  food: ['venue', 'cuisine', 'budgetRange', 'dietaryNotes', 'dietaryCustom', 'genderPreference', 'mbtiPreference', 'paymentMethod', 'memberRangeText']
});

function initialForm(type) {
  return {
    type,
    title: '', description: '', rules: '', placeLabel: '', startDate: '', startTime: '', minMembers: 2, maxMembers: 4, meetingPoint: null,
    originLabel: '', destinationLabel: '', timeFlexibility: 'WITHIN_30_MIN', transportPreference: 'DISCUSS_AFTER_FORMED', luggageType: 'NONE',
    companionMemberMode: 'fixed', companionMinFriends: 1, companionMaxFriends: 1,
    friendGenderPreference: '', mbtiPreference: '', navigationStyle: '', travelPace: '', photoHabit: '',
    silenceComfort: '', garlicPreference: '', fragrancePreference: '', slippersPreference: '',
    sportType: '', venue: '', level: 'ANY', intensity: 'MEDIUM', equipment: '',
    cuisine: '', budgetRange: '', dietaryNotes: '',
    genderPreference: '',
    paymentMethod: '', dietaryCustom: '', memberRangeText: '4'
  };
}

function cleanFormData(type, source = {}) {
  const initial = initialForm(type);
  const allowed = new Set(['type', ...COMMON_FORM_FIELDS, ...TYPE_FORM_FIELDS[type]]);
  const result = [...allowed].reduce((cleaned, field) => {
    cleaned[field] = Object.prototype.hasOwnProperty.call(source, field) ? source[field] : initial[field];
    return cleaned;
  }, { type });
  if (type === 'food' && !Object.prototype.hasOwnProperty.call(source, 'memberRangeText')
    && Object.prototype.hasOwnProperty.call(source, 'maxMembers')) {
    const minimum = Number(source.minMembers);
    const maximum = Number(source.maxMembers);
    result.memberRangeText = Number.isInteger(minimum) && Number.isInteger(maximum) && minimum < maximum
      ? `${minimum}-${maximum}`
      : String(source.maxMembers);
  }
  if (type === 'companion' && !Object.prototype.hasOwnProperty.call(source, 'companionMinFriends')) {
    const hasLegacyCapacity = Object.prototype.hasOwnProperty.call(source, 'minMembers')
      || Object.prototype.hasOwnProperty.call(source, 'maxMembers');
    if (hasLegacyCapacity) {
      const minimum = Math.min(20, Math.max(2, Number(source.minMembers) || 2));
      const maximum = Math.min(20, Math.max(minimum, Number(source.maxMembers) || minimum));
      result.companionMemberMode = minimum === maximum ? 'fixed' : 'range';
      result.companionMinFriends = minimum - 1;
      result.companionMaxFriends = maximum - 1;
    }
  }
  if (type === 'companion' && !['fixed', 'range'].includes(result.companionMemberMode)) {
    result.companionMemberMode = 'fixed';
  }
  if (type === 'companion') {
    Object.entries(COMPANION_FORM_ENUMS).forEach(([field, values]) => {
      if (!values.includes(result[field])) result[field] = initial[field];
    });
  }
  const meetingPoint = result.meetingPoint;
  if (!meetingPoint || typeof meetingPoint !== 'object'
    || meetingPoint.provider !== 'AMAP' || meetingPoint.coordinateSystem !== 'GCJ02'
    || !Number.isFinite(meetingPoint.latitude) || !Number.isFinite(meetingPoint.longitude)
    || typeof meetingPoint.label !== 'string' || !meetingPoint.label.trim()) {
    result.meetingPoint = null;
  } else {
    result.meetingPoint = {
      poiId: normalizedText(meetingPoint.poiId).slice(0, 80),
      label: normalizedText(meetingPoint.label).slice(0, 80),
      address: normalizedText(meetingPoint.address).slice(0, 120),
      latitude: Number(meetingPoint.latitude), longitude: Number(meetingPoint.longitude),
      coordinateSystem: 'GCJ02', provider: 'AMAP'
    };
  }
  return result;
}

function safeStartsAt(form) {
  try { return combineLocal(form.startDate, form.startTime); } catch (error) { return ''; }
}

function normalizedText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function truncateText(value, maxLength) {
  return Array.from(value).slice(0, maxLength).join('');
}

function selectedOptionIndex(options, value) {
  const index = options.indexOf(value);
  return index >= 0 ? index : 0;
}

function foodCapacity(form) {
  const configuredMinimum = Number(form.minMembers);
  const rawRange = normalizedText(form.memberRangeText);
  if (!Number.isInteger(configuredMinimum) || configuredMinimum < 2 || configuredMinimum > 20) {
    return { error: '请设置 2—20 人的总人数要求' };
  }
  if (!rawRange) return { minMembers: configuredMinimum, maxMembers: configuredMinimum };
  if (/^\d+$/.test(rawRange)) {
    const maximum = Number(rawRange);
    if (!Number.isInteger(maximum) || maximum < configuredMinimum || maximum > 20) return { error: '人数范围需在 2—20 人之间且不少于总人数要求' };
    return { minMembers: configuredMinimum, maxMembers: maximum };
  }
  const match = rawRange.match(/^(\d+)\s*[-—–]\s*(\d+)$/);
  if (!match) return { error: '人数范围格式应为如：2-5' };
  const lower = Number(match[1]);
  const upper = Number(match[2]);
  if (lower !== configuredMinimum) return { error: '人数范围起始值需与总人数要求一致' };
  if (lower < 2 || upper > 20 || lower > upper) return { error: '人数范围需在 2—20 人之间且格式正确' };
  return { minMembers: lower, maxMembers: upper };
}

function standardCapacity(form) {
  const minMembers = Number(form.minMembers);
  const maxMembers = Number(form.maxMembers);
  if (!Number.isInteger(minMembers) || !Number.isInteger(maxMembers) || minMembers < 2 || maxMembers > 20 || maxMembers < minMembers) {
    return { error: '请设置 2—20 人且合理的成团人数' };
  }
  return { minMembers, maxMembers };
}

function companionCapacity(form) {
  const minimum = Number(form.companionMinFriends);
  const maximum = form.companionMemberMode === 'range' ? Number(form.companionMaxFriends) : minimum;
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum)
    || minimum < 1 || maximum > 19
    || (form.companionMemberMode === 'range' ? maximum <= minimum : maximum < minimum)) {
    return { error: '拼友人数需在 1—19 位之间（成团总人数 2—20 人）' };
  }
  return { minMembers: minimum + 1, maxMembers: maximum + 1 };
}

function localDateText(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localDateAfter(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return localDateText(date);
}

function combinedDietaryNotes(form) {
  const values = normalizedText(form.dietaryNotes).split(',').map((item) => item.trim()).filter(Boolean);
  const custom = normalizedText(form.dietaryCustom);
  if (custom) values.push(custom);
  return [...new Set(values)].join('、');
}

function foodTitle(form) {
  const cuisine = normalizedText(form.cuisine) || '饭桌';
  const venue = normalizedText(form.venue) || '附近餐厅';
  return truncateText(`${cuisine}拼桌 · ${venue}`, 30);
}

function foodDescription(form) {
  const payment = normalizedText(form.paymentMethod);
  return truncateText(`一起去${normalizedText(form.venue)}吃${normalizedText(form.cuisine)}${payment ? `，${payment}` : ''}`, 300);
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
    flexibilityLabels: ['准时', '前后 30 分钟', '前后 60 分钟'],
    flexibilityIndex: 1,
    minStartDate: localDateAfter(0),
    maxStartDate: localDateAfter(6),
    transportOptions: [{ value: 'PUBLIC_TRANSIT', label: '公共交通' }, { value: 'LICENSED_TAXI', label: '正规出租车' }, { value: 'DISCUSS_AFTER_FORMED', label: '成团后商量' }],
    luggageOptions: [{ value: 'NONE', label: '无大件' }, { value: 'SMALL', label: '小行李' }, { value: 'LARGE', label: '大行李' }],
    genderPreferenceOptions: [{ value: 'ANY', label: '不限' }, { value: 'FEMALE', label: '女生优先' }, { value: 'MALE', label: '男生优先' }],
    companionMbtiOptions: [{ value: 'E', label: 'E 人带带我' }, { value: 'I', label: 'I 人慢热局' }, { value: 'ANY', label: '四字母随缘' }],
    navigationStyleOptions: [{ value: 'GUIDE', label: '人形地图' }, { value: 'FOLLOW', label: '跟着走就行' }, { value: 'LOST_CONFIDENT', label: '路痴但很自信' }],
    travelPaceOptions: [{ value: 'FAST', label: '特种兵模式' }, { value: 'RELAXED', label: '松弛感漫游' }, { value: 'SPONTANEOUS', label: '边走边决定' }],
    photoHabitOptions: [{ value: 'FIRST', label: '先拍再出发' }, { value: 'CASUAL', label: '随手记录派' }, { value: 'NO_CAMERA', label: '拒绝出镜' }],
    silenceComfortOptions: [{ value: 'CHATTY', label: '一路唠到底' }, { value: 'NATURAL', label: '有话再聊' }, { value: 'HEADPHONES', label: '各自戴耳机' }],
    garlicPreferenceOptions: [{ value: 'OK', label: '烟火气 OK' }, { value: 'FRESHEN', label: '口香糖就行' }, { value: 'AVOID', label: '有点介意' }],
    fragrancePreferenceOptions: [{ value: 'ANY', label: '浓淡随意' }, { value: 'LIGHT', label: '淡香 OK' }, { value: 'NONE', label: '无香更舒服' }],
    slippersPreferenceOptions: [{ value: 'RELAXED', label: '松弛感拉满' }, { value: 'CONTEXT', label: '看场合' }, { value: 'NEAT', label: '精致点更好' }],
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
    const form = cleanFormData(type, draft && draft.form);
    this.setData({
      contentTopInset: calculateContentTopInset(typeof wx === 'undefined' ? null : wx),
      type,
      meta: TYPES[type],
      typeIcon: TYPES[type].icon,
      form,
      timeIndex: selectedOptionIndex(this.data.timeOptions, form.startTime),
      flexibilityIndex: selectedOptionIndex(this.data.flexibilityOptions.map((item) => item.value), form.timeFlexibility),
      minStartDate: localDateAfter(0),
      maxStartDate: localDateAfter(6),
      cuisineIndex: selectedOptionIndex(this.data.cuisineOptions, form.cuisine),
      cuisineImage: CUISINE_IMAGES[form.cuisine] || '',
      paymentIndex: selectedOptionIndex(this.data.paymentOptions, form.paymentMethod),
      budgetIndex: selectedOptionIndex(this.data.budgetOptions, form.budgetRange),
      genderIndex: selectedOptionIndex(this.data.genderOptions, form.genderPreference),
      mbtiIndex: selectedOptionIndex(this.data.mbtiOptions, form.mbtiPreference),
      safetyAgreed: Boolean(draft && draft.safetyAgreed),
      submissionKey: `publish_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    });
  },

  onHide() { if (!this.data.submitting) this.saveDraft(); },
  onUnload() { if (!this.data.submitting) this.saveDraft(); },

  saveDraft() { wx.setStorageSync(this.draftKey, { form: cleanFormData(this.data.type, this.data.form), safetyAgreed: this.data.safetyAgreed, savedAt: Date.now() }); },

  handleInput(event) {
    const field = event.currentTarget.dataset.field;
    const linkedMeetingField = (this.data.type === 'companion' && field === 'originLabel')
      || (['sport', 'food'].includes(this.data.type) && field === 'venue');
    this.setData({
      [`form.${field}`]: event.detail.value,
      ...(linkedMeetingField ? { 'form.meetingPoint': null } : {}),
      errorMessage: ''
    });
  },
  handleDate(event) { this.setData({ 'form.startDate': event.detail.value, errorMessage: '' }); },
  handleTime(event) { const index = Number(event.detail.value) || 0; this.setData({ timeIndex: index, 'form.startTime': TIME_OPTIONS[index], errorMessage: '' }); },
  handleCompanionTime(event) { this.setData({ 'form.startTime': event.detail.value, errorMessage: '' }); },
  handleCompanionFlexibility(event) {
    const index = Number(event.detail.value) || 0;
    this.setData({ flexibilityIndex: index, 'form.timeFlexibility': this.data.flexibilityOptions[index].value, errorMessage: '' });
  },
  handleNumber(event) { const field = event.currentTarget.dataset.field; this.setData({ [`form.${field}`]: Number(event.detail.value) || 0, errorMessage: '' }); },
  handleChoice(event) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.currentTarget.dataset.value, errorMessage: '' }); },
  handleCompanionOptionalChoice(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.currentTarget.dataset.value;
    this.setData({ [`form.${field}`]: this.data.form[field] === value ? '' : value, errorMessage: '' });
  },
  handleCompanionMemberMode(event) {
    const mode = event.currentTarget.dataset.mode === 'range' ? 'range' : 'fixed';
    let minimum = Math.min(19, Math.max(1, Number(this.data.form.companionMinFriends) || 1));
    if (mode === 'range' && minimum === 19) minimum = 18;
    const maximum = mode === 'range'
      ? Math.min(19, Math.max(minimum + 1, Number(this.data.form.companionMaxFriends) || minimum + 1))
      : minimum;
    this.setData({
      'form.companionMemberMode': mode,
      'form.companionMinFriends': minimum,
      'form.companionMaxFriends': maximum,
      errorMessage: ''
    });
  },
  handleCompanionFriendNumber(event) {
    const field = event.currentTarget.dataset.field;
    const rawValue = String(event.detail.value || '').replace(/\D/g, '');
    this.setData({ [`form.${field}`]: rawValue === '' ? '' : Number(rawValue), errorMessage: '' });
  },
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
  handleOpenMeetingPointPicker() {
    wx.navigateTo({
      url: '/subpackages/publish/location-picker/index',
      events: {
        meetingPointSelected: (meetingPoint) => {
          const linkedField = this.data.type === 'companion' ? 'originLabel' : 'venue';
          this.setData({
            'form.meetingPoint': meetingPoint,
            [`form.${linkedField}`]: meetingPoint.label,
            errorMessage: ''
          });
        }
      },
      fail: () => this.setData({ errorMessage: '地点选择页打开失败，请稍后重试' })
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
    if (this.data.type !== 'food' && normalizedText(form.title).length < 2) return '请填写 2—30 个字的活动标题';
    if (!form.startDate || !form.startTime) return '请选择活动时间';
    const startsAt = safeStartsAt(form);
    if (!Number.isFinite(Date.parse(startsAt)) || Date.parse(startsAt) <= Date.now() + 5 * 60 * 1000) return '活动时间需至少晚于当前时间 5 分钟';
    if (Date.parse(startsAt) > Date.now() + 7 * 24 * 60 * 60 * 1000) return '活动时间不能超过未来 7 天';
    const capacity = this.data.type === 'food'
      ? foodCapacity(form)
      : this.data.type === 'companion' ? companionCapacity(form) : standardCapacity(form);
    if (capacity.error) return capacity.error;
    if (!form.meetingPoint || form.meetingPoint.provider !== 'AMAP' || form.meetingPoint.coordinateSystem !== 'GCJ02'
      || !Number.isFinite(form.meetingPoint.latitude) || !Number.isFinite(form.meetingPoint.longitude)) {
      return '请选择有效的活动会合地点';
    }
    if (this.data.type === 'companion' && (!form.originLabel.trim() || !form.destinationLabel.trim())) return '请填写出发地和目的地';
    if (this.data.type === 'sport' && (!form.sportType.trim() || !form.venue.trim())) return '请填写运动项目和活动场地';
    if (this.data.type === 'food' && (!form.venue.trim() || !form.cuisine.trim() || !FOOD_PAYMENT_VALUES[form.paymentMethod])) return '请填写餐厅、口味和拼桌形式';
    if (this.data.type === 'food' && form.paymentMethod === 'Fifty Fifty (均摊)' && !form.budgetRange.trim()) return '请选择人均预算';
    if (this.data.type === 'food' && combinedDietaryNotes(form).length > 100) return '饮食偏好不能超过 100 个字';
    if (!this.data.safetyAgreed) return '请阅读并同意拼单安全规则';
    return '';
  },

  buildPayload() {
    const form = this.data.form;
    const startsAt = safeStartsAt(form);
    const isFood = this.data.type === 'food';
    const capacity = isFood ? foodCapacity(form) : this.data.type === 'companion' ? companionCapacity(form) : standardCapacity(form);
    const common = {
      type: this.data.type,
      title: isFood ? foodTitle(form) : normalizedText(form.title),
      description: isFood ? foodDescription(form) : normalizedText(form.description),
      city: PILOT_CITY,
      district: PILOT_DISTRICTS[0],
      placeLabel: (this.data.type === 'companion' ? `${form.originLabel.trim()} → ${form.destinationLabel.trim()}` : form.venue.trim()),
      startsAt,
      deadlineAt: new Date(Date.parse(startsAt) - 30 * 60 * 1000).toISOString(),
      targetMembers: capacity.maxMembers,
      minMembers: capacity.minMembers,
      maxMembers: capacity.maxMembers,
      rules: normalizedText(form.rules)
    };
    common.meetingPoint = { ...form.meetingPoint };
    if (this.data.type === 'companion') common.typeData = {
      originLabel: form.originLabel.trim(),
      destinationLabel: form.destinationLabel.trim(),
      timeFlexibility: form.timeFlexibility,
      transportPreference: form.transportPreference,
      luggageType: form.luggageType,
      preferences: {
        friendGender: form.friendGenderPreference,
        mbti: form.mbtiPreference,
        navigationStyle: form.navigationStyle,
        travelPace: form.travelPace,
        photoHabit: form.photoHabit,
        silenceComfort: form.silenceComfort,
        garlic: form.garlicPreference,
        fragrance: form.fragrancePreference,
        slippers: form.slippersPreference
      }
    };
    if (this.data.type === 'sport') common.typeData = { sportType: form.sportType.trim(), venue: form.venue.trim(), level: form.level, intensity: form.intensity, equipment: form.equipment.trim() };
    if (this.data.type === 'food') common.typeData = {
      venue: normalizedText(form.venue),
      cuisine: normalizedText(form.cuisine),
      budgetRange: normalizedText(form.budgetRange),
      dietaryNotes: combinedDietaryNotes(form),
      paymentMethod: FOOD_PAYMENT_VALUES[form.paymentMethod] || '',
      genderPreference: FOOD_GENDER_VALUES[form.genderPreference] || '',
      mbtiPreference: normalizedText(form.mbtiPreference)
    };
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
