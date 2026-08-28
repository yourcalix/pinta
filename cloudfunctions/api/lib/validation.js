'use strict';

const { AppError, invariant } = require('./errors');
const {
  ACTIVITY_TYPES,
  PILOT_CITY,
  PILOT_DISTRICTS,
  MACAU_RIDE_ROUTES,
  MACAU_RIDE_ROUTE_IDS,
  MACAU_RIDE_CAMPUS_IDS,
  RIDE_FEE_TYPES,
  RIDE_LUGGAGE_RULES,
  RIDE_MIN_PASSENGERS,
  RIDE_MAX_PASSENGERS,
  RIDE_PICKUP_WINDOW_MINUTES,
  RIDE_PICKUP_SLOT_MINUTES,
  PRODUCT_DELIVERY_MODES,
  BUDDY_COST_MODES,
  BUDDY_LEVELS,
  REPORT_REASONS,
  ONBOARDING_ROLE_INTENTS,
  DRIVER_IDENTITY_TYPES,
  DRIVER_DOCUMENT_KINDS
} = require('./constants');

function optionalFilterString(value, field, max) {
  if (value === undefined || value === null || value === '') return '';
  invariant(typeof value === 'string', 'VALIDATION_ERROR', `${field}格式无效`, { field });
  return stringValue(value, field, { max });
}

function stringValue(value, field, options = {}) {
  const { min = 0, max = 200, required = false } = options;
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (required) invariant(normalized.length >= Math.max(1, min), 'VALIDATION_ERROR', `${field}不能为空`, { field });
  invariant(normalized.length <= max, 'VALIDATION_ERROR', `${field}长度不能超过${max}个字符`, { field });
  if (normalized && min > 0) invariant(normalized.length >= min, 'VALIDATION_ERROR', `${field}至少需要${min}个字符`, { field });
  return normalized;
}

function integerValue(value, field, min, max) {
  const number = Number(value);
  invariant(Number.isInteger(number) && number >= min && number <= max, 'VALIDATION_ERROR', `${field}必须在${min}到${max}之间`, { field });
  return number;
}

function enumValue(value, field, allowed) {
  invariant(allowed.includes(value), 'VALIDATION_ERROR', `${field}选项无效`, { field });
  return value;
}

function isoDateValue(value, field) {
  const normalized = stringValue(value, field, { required: true, max: 40 });
  const timestamp = Date.parse(normalized);
  invariant(Number.isFinite(timestamp), 'VALIDATION_ERROR', `${field}时间格式无效`, { field });
  return new Date(timestamp).toISOString();
}

function hasRidePrice(text) {
  if (!text) return false;
  return /(?:[¥￥$]\s*\d)|(?:\d+(?:\.\d+)?\s*(?:元|块|rmb|RMB))/.test(text);
}

function rideRoute(routeId) {
  const normalized = enumValue(routeId, '固定路线', MACAU_RIDE_ROUTE_IDS);
  return MACAU_RIDE_ROUTES.find((route) => route.id === normalized);
}

function isPickupSlotAligned(isoValue) {
  const date = new Date(isoValue);
  return date.getUTCSeconds() === 0
    && date.getUTCMilliseconds() === 0
    && date.getUTCMinutes() % RIDE_PICKUP_SLOT_MINUTES === 0;
}

function validateActivityInput(input, now = new Date()) {
  invariant(input && typeof input === 'object', 'VALIDATION_ERROR');
  const type = enumValue(input.type, '活动类型', ACTIVITY_TYPES);
  const startsAt = isoDateValue(input.startsAt, '开始时间');
  const deadlineAt = isoDateValue(input.deadlineAt, '报名截止时间');
  invariant(Date.parse(deadlineAt) > now.getTime(), 'VALIDATION_ERROR', '报名截止时间必须晚于当前时间', { field: 'deadlineAt' });
  invariant(Date.parse(startsAt) > Date.parse(deadlineAt), 'VALIDATION_ERROR', '开始时间必须晚于报名截止时间', { field: 'startsAt' });
  invariant(Date.parse(startsAt) - now.getTime() <= 7 * 24 * 60 * 60 * 1000, 'VALIDATION_ERROR', '活动开始时间不能超过7天', { field: 'startsAt' });

  const rideMinPassengers = type === 'ride'
    ? integerValue(input.minPassengers === undefined ? input.targetMembers : input.minPassengers, '最低成团人数', RIDE_MIN_PASSENGERS, RIDE_MAX_PASSENGERS)
    : null;
  const rideMaxPassengers = type === 'ride'
    ? integerValue(input.maxPassengers === undefined ? RIDE_MAX_PASSENGERS : input.maxPassengers, '最大乘客数', RIDE_MIN_PASSENGERS, RIDE_MAX_PASSENGERS)
    : null;
  if (type === 'ride') {
    invariant(rideMaxPassengers >= rideMinPassengers, 'VALIDATION_ERROR', '最大乘客数不能小于最低成团人数', { field: 'maxPassengers' });
    invariant(isPickupSlotAligned(startsAt), 'VALIDATION_ERROR', '期望出发时间必须按15分钟选择', { field: 'startsAt' });
  }

  const result = {
    type,
    title: stringValue(input.title, '标题', { required: true, min: 2, max: 30 }),
    description: stringValue(input.description, '补充说明', { max: 300 }),
    city: stringValue(input.city, '城市', { required: true, max: 20 }),
    district: stringValue(input.district, '行政区', { required: true, max: 30 }),
    placeLabel: stringValue(input.placeLabel, '商圈或地标', { required: true, max: 40 }),
    startsAt,
    deadlineAt,
    targetMembers: type === 'ride'
      ? rideMinPassengers
      : integerValue(input.targetMembers, '目标人数', 2, 20),
    contactInfo: stringValue(input.contactInfo, '成团后联系方式', { required: true, min: 2, max: 80 }),
    rules: stringValue(input.rules, '参与规则', { max: 200 })
  };

  const typeData = input.typeData || {};
  if (type === 'ride') {
    const route = rideRoute(typeData.routeId);
    const feeType = enumValue(typeData.feeType, '费用分摊模式', RIDE_FEE_TYPES);
    const pickupWindowEnd = isoDateValue(typeData.pickupWindowEnd, '期望时间窗结束时间');
    invariant(
      Date.parse(pickupWindowEnd) - Date.parse(startsAt) === RIDE_PICKUP_WINDOW_MINUTES * 60 * 1000,
      'VALIDATION_ERROR',
      '期望接车时间窗必须为60分钟',
      { field: 'pickupWindowEnd' }
    );
    const luggageRule = typeData.luggageRule
      ? enumValue(typeData.luggageRule, '行李规则', RIDE_LUGGAGE_RULES)
      : 'ONE_SMALL';
    const priceText = [result.title, result.description, result.rules].join(' ');
    invariant(!hasRidePrice(priceText), 'VALIDATION_ERROR', '拼车仅允许合理成本均摊，不能填写具体收费金额', { field: 'description' });
    result.city = PILOT_CITY;
    result.district = PILOT_DISTRICTS[0];
    result.placeLabel = `${route.originLabel} → ${route.destinationLabel}`;
    result.minPassengers = rideMinPassengers;
    result.maxPassengers = rideMaxPassengers;
    result.typeData = {
      routeId: route.id,
      routeCode: route.code,
      origin: { id: route.originId, label: route.originLabel },
      destination: { id: route.destinationId, label: route.destinationLabel },
      pickupWindowEnd,
      feeType,
      luggageRule
    };
  }

  if (type === 'product') {
    result.typeData = {
      productName: stringValue(typeData.productName, '商品名称', { required: true, max: 40 }),
      targetQuantity: integerValue(typeData.targetQuantity, '目标数量', 2, 999),
      unitPriceRange: stringValue(typeData.unitPriceRange, '预估单价区间', { required: true, max: 30 }),
      shoppingChannel: stringValue(typeData.shoppingChannel, '购买渠道', { required: true, max: 50 }),
      deliveryMode: enumValue(typeData.deliveryMode, '交付方式', PRODUCT_DELIVERY_MODES)
    };
  }

  if (type === 'buddy') {
    result.typeData = {
      category: stringValue(typeData.category, '活动类别', { required: true, max: 20 }),
      costMode: enumValue(typeData.costMode, '费用方式', BUDDY_COST_MODES),
      level: enumValue(typeData.level, '活动强度', BUDDY_LEVELS),
      equipment: stringValue(typeData.equipment, '装备要求', { max: 100 })
    };
  }

  return result;
}

function validateActivityListInput(input) {
  invariant(input && typeof input === 'object' && !Array.isArray(input), 'VALIDATION_ERROR');
  const type = optionalFilterString(input.type, '活动类型', 20);
  const city = optionalFilterString(input.city, '城市', 20) || PILOT_CITY;
  const district = optionalFilterString(input.district, '行政区', 30);
  const keyword = optionalFilterString(input.keyword, '搜索词', 30);
  const routeId = optionalFilterString(input.routeId, '固定路线', 40);
  const campusId = optionalFilterString(input.campusId, '校区', 40);
  const viewMode = optionalFilterString(input.viewMode, '浏览视角', 20) || 'passenger';
  if (type) enumValue(type, '活动类型', ACTIVITY_TYPES);
  invariant(city === PILOT_CITY, 'VALIDATION_ERROR', '当前仅支持澳门试点', { field: 'city' });
  if (district) enumValue(district, '行政区', PILOT_DISTRICTS);
  if (routeId) enumValue(routeId, '固定路线', MACAU_RIDE_ROUTE_IDS);
  if (campusId) enumValue(campusId, '校区', MACAU_RIDE_CAMPUS_IDS);
  enumValue(viewMode, '浏览视角', ['passenger', 'driver']);
  return {
    type: type || undefined,
    city,
    district: district || undefined,
    keyword: keyword || undefined,
    routeId: routeId || undefined,
    campusId: campusId || undefined,
    viewMode
  };
}

function validateRideDriverAcceptInput(input) {
  invariant(input && typeof input === 'object', 'VALIDATION_ERROR');
  const pickupAt = isoDateValue(input.pickupAt, '接车时间');
  invariant(isPickupSlotAligned(pickupAt), 'INVALID_PICKUP_SLOT');
  return {
    activityId: validateId(input.activityId, '活动ID'),
    vehicleId: validateId(input.vehicleId, '车辆ID'),
    pickupAt
  };
}

function validateRideDriverCancelInput(input) {
  invariant(input && typeof input === 'object', 'VALIDATION_ERROR');
  return {
    activityId: validateId(input.activityId, '活动ID'),
    reason: stringValue(input.reason, '取消原因', { required: true, max: 120 })
  };
}

function validateApplicationInput(input) {
  invariant(input && typeof input === 'object', 'VALIDATION_ERROR');
  invariant(input.autoJoinConsent === true, 'VALIDATION_ERROR', '请确认获批后自动加入并占用名额', { field: 'autoJoinConsent' });
  return {
    activityId: stringValue(input.activityId, '活动ID', { required: true, max: 80 }),
    note: stringValue(input.note, '申请说明', { max: 120 }),
    autoJoinConsent: true
  };
}

function validateProfileInput(input) {
  invariant(input && typeof input === 'object', 'VALIDATION_ERROR');
  invariant(input.adultConfirmed === true, 'VALIDATION_ERROR', 'MVP 仅面向18岁及以上用户', { field: 'adultConfirmed' });
  const interests = Array.isArray(input.interests)
    ? input.interests.slice(0, 8).map((item) => stringValue(item, '兴趣标签', { max: 16 })).filter(Boolean)
    : [];
  return {
    nickname: stringValue(input.nickname, '昵称', { required: true, min: 2, max: 20 }),
    city: stringValue(input.city, '城市', { required: true, max: 20 }),
    interests,
    adultConfirmed: true
  };
}

function validateOnboardingRoleInput(input) {
  invariant(input && typeof input === 'object', 'VALIDATION_ERROR');
  return { roleIntent: enumValue(input.roleIntent, '注册身份', ONBOARDING_ROLE_INTENTS) };
}

function validateDriverApplicationInput(input, now = new Date()) {
  invariant(input && typeof input === 'object', 'VALIDATION_ERROR');
  invariant(input.consent && input.consent.driverVerify === true && input.consent.sensitiveDocuments === true, 'DRIVER_CONSENT_REQUIRED');
  const documents = input.documents && typeof input.documents === 'object' ? input.documents : {};
  const requiredDocuments = DRIVER_DOCUMENT_KINDS;
  requiredDocuments.forEach((kind) => invariant(
    documents[kind] && typeof documents[kind] === 'object',
    'DRIVER_DOCUMENT_REQUIRED',
    '请补齐司机认证所需资料',
    { field: `documents.${kind}` }
  ));
  const identityExpiresAt = isoDateValue(input.identityExpiresAt, '身份证件有效期');
  const driverLicenseExpiresAt = isoDateValue(input.driverLicenseExpiresAt, '驾驶证有效期');
  invariant(Date.parse(identityExpiresAt) > now.getTime(), 'VALIDATION_ERROR', '身份证件必须在有效期内', { field: 'identityExpiresAt' });
  invariant(Date.parse(driverLicenseExpiresAt) > now.getTime(), 'VALIDATION_ERROR', '驾驶证必须在有效期内', { field: 'driverLicenseExpiresAt' });
  const cleanNumber = (value, field) => {
    const normalized = stringValue(value, field, { required: true, min: 5, max: 32 }).replace(/[\s-]+/g, '');
    invariant(/^[A-Za-z0-9()]+$/.test(normalized), 'VALIDATION_ERROR', `${field}格式无效`, { field });
    return normalized;
  };
  return {
    legalName: stringValue(input.legalName, '真实姓名', { required: true, min: 2, max: 40 }),
    identityType: enumValue(input.identityType, '证件类型', DRIVER_IDENTITY_TYPES),
    identityNumber: cleanNumber(input.identityNumber, '证件号码'),
    identityExpiresAt,
    driverLicenseNumber: cleanNumber(input.driverLicenseNumber, '驾驶证号码'),
    driverLicenseExpiresAt,
    vehicleType: stringValue(input.vehicleType, '车辆类型', { required: true, max: 30 }),
    passengerCapacity: integerValue(input.passengerCapacity, '核定乘客数', 2, 7),
    plateNumber: cleanNumber(input.plateNumber, '车牌号码'),
    documents: Object.fromEntries(Object.entries(documents).map(([kind, reference]) => {
      enumValue(kind, '文件类型', DRIVER_DOCUMENT_KINDS);
      return [kind, {
        uploadId: validateId(reference.uploadId, '上传凭据')
      }];
    })),
    consent: {
      privacyVersion: stringValue(input.consent.privacyVersion, '隐私说明版本', { required: true, max: 30 }),
      driverVerify: true,
      sensitiveDocuments: true
    }
  };
}

function validateDriverDocumentPrepareInput(input) {
  invariant(input && typeof input === 'object', 'VALIDATION_ERROR');
  return { kind: enumValue(input.kind, '文件类型', DRIVER_DOCUMENT_KINDS) };
}

function validateDriverDocumentConfirmInput(input) {
  invariant(input && typeof input === 'object', 'VALIDATION_ERROR');
  return {
    kind: enumValue(input.kind, '文件类型', DRIVER_DOCUMENT_KINDS),
    uploadId: validateId(input.uploadId, '上传凭据'),
    fileID: stringValue(input.fileID, '私有文件引用', { required: true, max: 300 })
  };
}

function validateReportInput(input) {
  invariant(input && typeof input === 'object', 'VALIDATION_ERROR');
  return {
    targetType: enumValue(input.targetType, '举报对象类型', ['activity', 'user']),
    targetId: stringValue(input.targetId, '举报对象', { required: true, max: 80 }),
    reason: enumValue(input.reason, '举报原因', REPORT_REASONS),
    description: stringValue(input.description, '举报说明', { max: 300 })
  };
}

function validateActivityQuestionInput(input) {
  invariant(input && typeof input === 'object', 'VALIDATION_ERROR');
  return {
    activityId: stringValue(input.activityId, '活动ID', { required: true, max: 80 }),
    content: stringValue(input.content, '问题内容', { required: true, min: 2, max: 200 })
  };
}

function validateActivityQuestionAnswerInput(input) {
  invariant(input && typeof input === 'object', 'VALIDATION_ERROR');
  return {
    activityId: stringValue(input.activityId, '活动ID', { required: true, max: 80 }),
    questionId: stringValue(input.questionId, '问题ID', { required: true, max: 80 }),
    content: stringValue(input.content, '回答内容', { required: true, min: 1, max: 300 })
  };
}

function validateId(value, field = 'ID') {
  return stringValue(value, field, { required: true, max: 80 });
}

function requireIdempotencyKey(value) {
  const key = stringValue(value, '幂等键', { required: true, min: 8, max: 100 });
  if (!/^[A-Za-z0-9:_-]+$/.test(key)) {
    throw new AppError('VALIDATION_ERROR', '幂等键格式无效', { field: 'idempotencyKey' });
  }
  return key;
}

module.exports = {
  hasRidePrice,
  validateActivityInput,
  validateActivityListInput,
  validateRideDriverAcceptInput,
  validateRideDriverCancelInput,
  validateApplicationInput,
  validateProfileInput,
  validateOnboardingRoleInput,
  validateDriverApplicationInput,
  validateDriverDocumentPrepareInput,
  validateDriverDocumentConfirmInput,
  validateReportInput,
  validateActivityQuestionInput,
  validateActivityQuestionAnswerInput,
  validateId,
  requireIdempotencyKey,
  stringValue
};
