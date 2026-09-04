'use strict';

const { AppError, invariant } = require('./errors');
const { decodeCursor, assertCommunityTextSafe } = require('./community');
const { decodeDirectCursor, assertDirectMessageTextSafe } = require('./direct-message');
const {
  ACTIVITY_TYPES,
  PILOT_CITY,
  PILOT_DISTRICTS,
  MEMBER_LUGGAGE_TYPES,
  COMPANION_TIME_FLEXIBILITY,
  COMPANION_TRANSPORT_PREFERENCES,
  SPORT_LEVELS,
  SPORT_INTENSITIES,
  REPORT_REASONS,
  USER_GENDERS
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

function memberLuggageType(value) {
  invariant(MEMBER_LUGGAGE_TYPES.includes(value), 'VALIDATION_ERROR', '我的行李选项无效', { field: 'luggageType' });
  return value;
}

function isoDateValue(value, field) {
  const normalized = stringValue(value, field, { required: true, max: 40 });
  const timestamp = Date.parse(normalized);
  invariant(Number.isFinite(timestamp), 'VALIDATION_ERROR', `${field}时间格式无效`, { field });
  return new Date(timestamp).toISOString();
}

function validateActivityInput(input, now = new Date()) {
  invariant(input && typeof input === 'object', 'VALIDATION_ERROR');
  const type = enumValue(input.type, '活动类型', ACTIVITY_TYPES);
  const startsAt = isoDateValue(input.startsAt, '开始时间');
  const deadlineAt = isoDateValue(input.deadlineAt, '报名截止时间');
  invariant(Date.parse(deadlineAt) > now.getTime(), 'VALIDATION_ERROR', '报名截止时间必须晚于当前时间', { field: 'deadlineAt' });
  invariant(Date.parse(startsAt) > Date.parse(deadlineAt), 'VALIDATION_ERROR', '开始时间必须晚于报名截止时间', { field: 'startsAt' });
  invariant(Date.parse(startsAt) - now.getTime() <= 7 * 24 * 60 * 60 * 1000, 'VALIDATION_ERROR', '活动开始时间不能超过7天', { field: 'startsAt' });

  const minMembers = integerValue(input.minMembers === undefined ? 2 : input.minMembers, '最低成团人数', 2, 20);
  const maxMembers = integerValue(input.maxMembers === undefined ? input.targetMembers : input.maxMembers, '最多人数', 2, 20);
  invariant(maxMembers >= minMembers, 'VALIDATION_ERROR', '最多人数不能小于最低成团人数', { field: 'maxMembers' });

  const result = {
    type,
    title: stringValue(input.title, '标题', { required: true, min: 2, max: 30 }),
    description: stringValue(input.description, '补充说明', { max: 300 }),
    city: stringValue(input.city, '城市', { required: true, max: 20 }),
    district: stringValue(input.district, '行政区', { required: true, max: 30 }),
    placeLabel: stringValue(input.placeLabel, '商圈或地标', { required: true, max: 40 }),
    startsAt,
    deadlineAt,
    targetMembers: maxMembers,
    minMembers,
    maxMembers,
    rules: stringValue(input.rules, '参与规则', { max: 200 })
  };

  const typeData = input.typeData || {};
  if (type === 'companion') {
    const originLabel = stringValue(typeData.originLabel, '出发地', { required: true, max: 40 });
    const destinationLabel = stringValue(typeData.destinationLabel, '目的地', { required: true, max: 40 });
    result.placeLabel = `${originLabel} → ${destinationLabel}`;
    result.typeData = {
      originLabel,
      destinationLabel,
      timeFlexibility: enumValue(typeData.timeFlexibility, '时间弹性', COMPANION_TIME_FLEXIBILITY),
      transportPreference: enumValue(typeData.transportPreference, '出行方式倾向', COMPANION_TRANSPORT_PREFERENCES),
      luggageType: memberLuggageType(typeData.luggageType || 'NONE')
    };
  }

  if (type === 'sport') {
    result.typeData = {
      sportType: stringValue(typeData.sportType, '运动项目', { required: true, max: 30 }),
      venue: stringValue(typeData.venue, '活动场地', { required: true, max: 50 }),
      level: enumValue(typeData.level, '参与水平', SPORT_LEVELS),
      intensity: enumValue(typeData.intensity, '活动强度', SPORT_INTENSITIES),
      equipment: stringValue(typeData.equipment, '装备要求', { max: 100 })
    };
  }

  if (type === 'food') {
    result.typeData = {
      venue: stringValue(typeData.venue, '餐厅或食堂', { required: true, max: 50 }),
      cuisine: stringValue(typeData.cuisine, '口味或菜系', { required: true, max: 30 }),
      budgetRange: stringValue(typeData.budgetRange, '人均预算', { required: true, max: 30 }),
      dietaryNotes: stringValue(typeData.dietaryNotes, '饮食偏好', { max: 100 })
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
  if (type) enumValue(type, '活动类型', ACTIVITY_TYPES);
  invariant(city === PILOT_CITY, 'VALIDATION_ERROR', '当前仅支持试点区域', { field: 'city' });
  if (district) enumValue(district, '行政区', PILOT_DISTRICTS);
  return {
    type: type || undefined,
    city,
    district: district || undefined,
    keyword: keyword || undefined
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
    gender: enumValue(input.gender, '性别', USER_GENDERS),
    city: stringValue(input.city, '城市', { required: true, max: 20 }),
    interests,
    adultConfirmed: true
  };
}

function validateReportInput(input) {
  invariant(input && typeof input === 'object', 'VALIDATION_ERROR');
  return {
    targetType: enumValue(input.targetType, '举报对象类型', ['activity', 'user', 'communityPost', 'communityReply', 'directConversation']),
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

function validateCommunityListInput(input = {}) {
  invariant(input && typeof input === 'object' && !Array.isArray(input), 'VALIDATION_ERROR');
  return {
    cursor: decodeCursor(input.cursor),
    limit: integerValue(input.limit === undefined ? 20 : input.limit, '分页数量', 1, 30)
  };
}

function validateCommunityPostCreateInput(input) {
  invariant(input && typeof input === 'object', 'VALIDATION_ERROR');
  return { content: assertCommunityTextSafe(stringValue(input.content, '讨论内容', { required: true, min: 2, max: 500 })) };
}

function validateCommunityReplyCreateInput(input) {
  invariant(input && typeof input === 'object', 'VALIDATION_ERROR');
  return {
    postId: validateId(input.postId, '帖子ID'),
    content: assertCommunityTextSafe(stringValue(input.content, '回复内容', { required: true, min: 1, max: 300 }))
  };
}

function validateCommunityLikeInput(input) {
  invariant(input && typeof input === 'object' && !Array.isArray(input), 'VALIDATION_ERROR');
  invariant(['post', 'reply'].includes(input.targetType), 'VALIDATION_ERROR', '点赞目标类型无效');
  invariant(typeof input.liked === 'boolean', 'VALIDATION_ERROR', '点赞状态无效');
  return { targetType: input.targetType, targetId: validateId(input.targetId, '点赞目标ID'), liked: input.liked };
}

function validateDirectMessageListInput(input = {}) {
  invariant(input && typeof input === 'object' && !Array.isArray(input), 'VALIDATION_ERROR');
  return {
    cursor: decodeDirectCursor(input.cursor),
    limit: integerValue(input.limit === undefined ? 20 : input.limit, '分页数量', 1, 30)
  };
}

function validateDirectConversationCreateInput(input) {
  invariant(input && typeof input === 'object' && !Array.isArray(input), 'VALIDATION_ERROR');
  return {
    activityId: validateId(input.activityId, '活动ID'),
    memberId: validateId(input.memberId, '成员ID')
  };
}

function validateDirectMessageCreateInput(input) {
  invariant(input && typeof input === 'object' && !Array.isArray(input), 'VALIDATION_ERROR');
  const clientMessageId = stringValue(input.clientMessageId, '客户端消息ID', { required: true, min: 8, max: 80 });
  invariant(/^[A-Za-z0-9:_-]+$/.test(clientMessageId), 'VALIDATION_ERROR', '客户端消息ID格式无效');
  return {
    conversationId: validateId(input.conversationId, '会话ID'),
    clientMessageId,
    text: assertDirectMessageTextSafe(stringValue(input.text, '消息内容', { required: true, min: 1, max: 500 }))
  };
}

function validateGroupMessageListInput(input = {}) {
  invariant(input && typeof input === 'object' && !Array.isArray(input), 'VALIDATION_ERROR');
  const before = input.before === undefined || input.before === null ? null : input.before;
  invariant(before === null || Number.isSafeInteger(before) && before >= 0, 'VALIDATION_ERROR', '分页游标无效');
  return {
    activityId: validateId(input.activityId, '活动ID'),
    before,
    limit: integerValue(input.limit === undefined ? 20 : input.limit, '分页数量', 1, 30)
  };
}

function validateGroupMessageCreateInput(input) {
  invariant(input && typeof input === 'object' && !Array.isArray(input), 'VALIDATION_ERROR');
  const clientMessageId = stringValue(input.clientMessageId, '客户端消息ID', { required: true, min: 8, max: 80 });
  invariant(/^[A-Za-z0-9_-]+$/.test(clientMessageId), 'VALIDATION_ERROR', '客户端消息ID格式无效');
  return {
    activityId: validateId(input.activityId, '活动ID'),
    generation: integerValue(input.generation, '成员周期', 1, Number.MAX_SAFE_INTEGER - 1),
    clientMessageId,
    text: assertDirectMessageTextSafe(stringValue(input.text, '消息内容', { required: true, min: 1, max: 500 }))
  };
}

function validateGroupReadInput(input) {
  invariant(input && typeof input === 'object' && !Array.isArray(input), 'VALIDATION_ERROR');
  return {
    activityId: validateId(input.activityId, '活动ID'),
    generation: integerValue(input.generation, '成员周期', 1, Number.MAX_SAFE_INTEGER - 1),
    messageId: validateId(input.messageId, '已读消息ID'),
    sequence: integerValue(input.sequence, '已读消息序号', 1, Number.MAX_SAFE_INTEGER - 1)
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
  validateActivityInput,
  validateActivityListInput,
  validateApplicationInput,
  validateProfileInput,
  validateReportInput,
  validateActivityQuestionInput,
  validateActivityQuestionAnswerInput,
  validateCommunityListInput,
  validateCommunityPostCreateInput,
  validateCommunityReplyCreateInput,
  validateCommunityLikeInput,
  validateDirectMessageListInput,
  validateDirectConversationCreateInput,
  validateDirectMessageCreateInput,
  validateGroupMessageListInput,
  validateGroupMessageCreateInput,
  validateGroupReadInput,
  validateId,
  requireIdempotencyKey,
  stringValue
};
