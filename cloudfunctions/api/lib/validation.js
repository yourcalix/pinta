'use strict';

const { AppError, invariant } = require('./errors');
const {
  ACTIVITY_TYPES,
  RIDE_FEE_TYPES,
  RIDE_LUGGAGE_RULES,
  PRODUCT_DELIVERY_MODES,
  BUDDY_COST_MODES,
  BUDDY_LEVELS,
  REPORT_REASONS
} = require('./constants');

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

function validateActivityInput(input, now = new Date()) {
  invariant(input && typeof input === 'object', 'VALIDATION_ERROR');
  const type = enumValue(input.type, '活动类型', ACTIVITY_TYPES);
  const startsAt = isoDateValue(input.startsAt, '开始时间');
  const deadlineAt = isoDateValue(input.deadlineAt, '报名截止时间');
  invariant(Date.parse(deadlineAt) > now.getTime(), 'VALIDATION_ERROR', '报名截止时间必须晚于当前时间', { field: 'deadlineAt' });
  invariant(Date.parse(startsAt) > Date.parse(deadlineAt), 'VALIDATION_ERROR', '开始时间必须晚于报名截止时间', { field: 'startsAt' });
  invariant(Date.parse(startsAt) - now.getTime() <= 7 * 24 * 60 * 60 * 1000, 'VALIDATION_ERROR', '活动开始时间不能超过7天', { field: 'startsAt' });

  const result = {
    type,
    title: stringValue(input.title, '标题', { required: true, min: 2, max: 30 }),
    description: stringValue(input.description, '补充说明', { max: 300 }),
    city: stringValue(input.city, '城市', { required: true, max: 20 }),
    district: stringValue(input.district, '行政区', { required: true, max: 30 }),
    placeLabel: stringValue(input.placeLabel, '商圈或地标', { required: true, max: 40 }),
    startsAt,
    deadlineAt,
    targetMembers: integerValue(input.targetMembers, '目标人数', 2, 20),
    contactInfo: stringValue(input.contactInfo, '成团后联系方式', { required: true, min: 2, max: 80 }),
    rules: stringValue(input.rules, '参与规则', { max: 200 })
  };

  const typeData = input.typeData || {};
  if (type === 'ride') {
    const feeType = enumValue(typeData.feeType, '费用分摊模式', RIDE_FEE_TYPES);
    const origin = stringValue(typeData.origin, '出发区域', { required: true, max: 40 });
    const destination = stringValue(typeData.destination, '到达区域', { required: true, max: 40 });
    const luggageRule = typeData.luggageRule
      ? enumValue(typeData.luggageRule, '行李规则', RIDE_LUGGAGE_RULES)
      : 'ONE_SMALL';
    const priceText = [result.title, result.description, result.rules].join(' ');
    invariant(!hasRidePrice(priceText), 'VALIDATION_ERROR', '拼车仅允许合理成本均摊，不能填写具体收费金额', { field: 'description' });
    result.typeData = { origin, destination, feeType, luggageRule };
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
  validateApplicationInput,
  validateProfileInput,
  validateReportInput,
  validateActivityQuestionInput,
  validateActivityQuestionAnswerInput,
  validateId,
  requireIdempotencyKey,
  stringValue
};
