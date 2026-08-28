'use strict';

const {
  PILOT_CITY,
  PILOT_DISTRICTS,
  RIDE_ROUTES,
  getRideRoute
} = require('../config/locations');

const ACTIVITY_TYPES = Object.freeze(['ride', 'product', 'buddy']);

const STATE_KEY = 'pinba_mock_state_v2';
const PERSONA_KEY = 'pinba_mock_persona_v1';
const MUTATING_ACTIONS = new Set([
  'profile.update',
  'onboarding.selectRole',
  'driver.application.submit',
  'driver.document.prepare',
  'driver.document.confirm',
  'driver.application.withdraw',
  'admin.driverApplication.review',
  'activity.create',
  'activity.cancel',
  'activity.complete',
  'activity.question.ask',
  'activity.question.answer',
  'application.submit',
  'application.approve',
  'application.reject',
  'application.withdraw',
  'ride.join',
  'member.leave',
  'notification.read',
  'report.create',
  'admin.activity.suspend',
  'ride.driver.accept',
  'ride.driver.cancel'
]);
const BUSINESS_IDEMPOTENT_ACTIONS = new Set(['driver.application.submit', 'admin.driverApplication.review']);
const PUBLIC_ACTIONS = new Set(['activity.list', 'activity.detail', 'activity.question.list']);
const MAX_PUBLIC_SCAN = 500;
const mockSensitiveHashSalt = `${Date.now()}:${Math.random()}:${Math.random()}`;

function resolveNotificationTarget(type) {
  if (type === 'NEW_APPLICATION') return 'MANAGE';
  if (type === 'GROUP_FORMED') return 'GROUP';
  return 'DETAIL';
}

function parsePublicCursor(value) {
  if (value === undefined || value === null || value === '') return 0;
  const validNumber = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  const validString = typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value));
  assert(validNumber || validString, 'VALIDATION_ERROR', '分页游标无效');
  return Number(value);
}

function stableSerialize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function opaqueSensitiveHash(value) {
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  const input = `${mockSensitiveHashSalt}:${value}`;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    hashA = Math.imul(hashA ^ code, 0x01000193) >>> 0;
    hashB = Math.imul(hashB ^ code, 0x85ebca6b) >>> 0;
  }
  return `${hashA.toString(16).padStart(8, '0')}${hashB.toString(16).padStart(8, '0')}`;
}

function normalizeActivityForRead(activity, now) {
  if (!activity) return activity;
  if (activity.type === 'ride') {
    activity = {
      ...activity,
      targetMembers: 7,
      minPassengers: 7,
      maxPassengers: 7,
      status: ['RECRUITING', 'FORMED'].includes(activity.status)
        ? (Number(activity.memberCount || 0) >= 7 ? 'FORMED' : 'RECRUITING')
        : activity.status
    };
  }
  const deadline = Date.parse(activity.deadlineAt);
  const at = Date.parse(now);
  if (!Number.isFinite(at)) return activity;
  if (activity.type !== 'ride' && activity.status === 'RECRUITING' && Number.isFinite(deadline) && deadline <= at) {
    return { ...activity, status: 'EXPIRED' };
  }
  const pickupWindowEnd = Date.parse(activity.typeData && activity.typeData.pickupWindowEnd);
  if (activity.type === 'ride'
    && ['RECRUITING', 'FORMED'].includes(activity.status)
    && (!activity.rideFulfillment || activity.rideFulfillment.status === 'UNASSIGNED')
    && Number.isFinite(pickupWindowEnd)
    && pickupWindowEnd <= at) {
    return { ...activity, status: 'EXPIRED', rideJoinable: false };
  }
  return activity;
}

function isoAfter(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasRidePrice(text) {
  return /(?:[¥￥$]\s*\d)|(?:\d+(?:\.\d+)?\s*(?:元|块|rmb|RMB))/.test(text || '');
}

function seedState() {
  const now = new Date().toISOString();
  const rideStartDate = new Date(Date.now() + 26 * 60 * 60 * 1000);
  rideStartDate.setMinutes(Math.ceil(rideStartDate.getMinutes() / 15) * 15, 0, 0);
  const rideStartsAt = rideStartDate.toISOString();
  const rideWindowEnd = new Date(rideStartDate.getTime() + 60 * 60 * 1000).toISOString();
  return {
    schemaVersion: 4,
    sequence: 100,
    users: [
      { id: 'u_owner', role: 'user', status: 'ACTIVE', profile: { nickname: '小拼', city: '澳门', interests: ['校园出行'], adultConfirmed: true } },
      { id: 'u_member', role: 'user', status: 'ACTIVE', profile: { nickname: '阿同', city: '澳门', interests: ['校园出行'], adultConfirmed: true } },
      { id: 'u_driver', role: 'user', status: 'ACTIVE', onboarding: { roleIntent: 'DRIVER', completedAt: now }, profile: { nickname: '林师傅', city: '澳门', interests: ['校园互助'], adultConfirmed: true } },
      { id: 'u_merchant', role: 'user', status: 'ACTIVE', profile: { nickname: '邻里团长', city: '澳门', interests: ['凑单'], adultConfirmed: true } },
      { id: 'u_admin', role: 'admin', status: 'ACTIVE', profile: { nickname: '运营', city: '澳门', interests: [], adultConfirmed: true } },
      { id: 'u_disabled', role: 'user', status: 'DISABLED', profile: { nickname: '受限账号', city: '澳门', interests: [], adultConfirmed: true } }
    ],
    activities: [
      {
        id: 'a_ride', ownerId: 'u_owner', owner: { nickname: '小拼' }, type: 'ride',
        title: '青茂口岸到凼仔校区', description: '周五晚从青茂口岸回校，寻找同路同学。',
        city: '澳门', district: '澳门校园', placeLabel: '青茂口岸 → 凼仔校区',
        startsAt: rideStartsAt, deadlineAt: isoAfter(18), targetMembers: 7, minPassengers: 7, maxPassengers: 7, memberCount: 1,
        contactInfo: '微信号 pinba_xiaopin', rules: '成团后在青茂口岸附近公共区域确认具体上车点。',
        typeData: {
          routeId: 'QINGMAO_TO_TAIPA', routeCode: '青城',
          origin: { id: 'QINGMAO', label: '青茂口岸' }, destination: { id: 'TAIPA_CAMPUS', label: '凼仔校区' },
          pickupWindowEnd: rideWindowEnd, feeType: 'SHARED_COST', luggageRule: 'ONE_SMALL'
        },
        status: 'RECRUITING', version: 1, createdAt: now, updatedAt: now
      },
      {
        id: 'a_product', ownerId: 'u_merchant', owner: { nickname: '邻里团长' }, type: 'product',
        title: '精品咖啡豆四袋凑单', description: '官方旗舰店满减，成团后线下验货自提，不提前收款。',
        city: '澳门', district: '澳门校园', placeLabel: '校园公共区域',
        startsAt: isoAfter(40), deadlineAt: isoAfter(28), targetMembers: 3, memberCount: 1,
        contactInfo: '微信号 coffee_pin_01', rules: '到货后在商场公共区域当面验货交付。',
        typeData: { productName: '中度烘焙咖啡豆', targetQuantity: 4, unitPriceRange: '58—68元/袋', shoppingChannel: '品牌官方旗舰店', deliveryMode: 'FACE_TO_FACE' },
        status: 'RECRUITING', version: 1, createdAt: now, updatedAt: now
      },
      {
        id: 'a_buddy', ownerId: 'u_owner', owner: { nickname: '小拼' }, type: 'buddy',
        title: '周末新手羽毛球双打', description: '新手友好，轻松运动一小时，场地费AA。',
        city: '澳门', district: '澳门校园', placeLabel: '校园体育馆',
        startsAt: isoAfter(10), deadlineAt: isoAfter(5), targetMembers: 2, memberCount: 2,
        contactInfo: '微信号 pinba_xiaopin', rules: '体育馆一楼前台旁会合，请自带球拍。',
        typeData: { category: '运动', costMode: 'AA', level: 'BEGINNER', equipment: '自带球拍' },
        status: 'FORMED', version: 2, formedAt: now, createdAt: now, updatedAt: now
      },
      {
        id: 'a_suspended', ownerId: 'u_owner', owner: { nickname: '小拼' }, type: 'buddy',
        title: '已下架活动测试数据', description: '仅用于验证下架状态，不应出现在公开列表或详情中。',
        city: '澳门', district: '澳门校园', placeLabel: '测试地点',
        startsAt: isoAfter(12), deadlineAt: isoAfter(6), targetMembers: 2, memberCount: 1,
        contactInfo: '微信号 pinba_suspended', rules: '内部测试规则',
        typeData: { category: '测试', costMode: 'AA', level: 'BEGINNER', equipment: '' },
        status: 'SUSPENDED', version: 2,
        suspension: { adminId: 'admin_mock', reason: '测试运营处置原因', at: now },
        createdAt: now, updatedAt: now
      }
    ],
    drivers: [
      { userId: 'u_driver', status: 'ACTIVE', reviewStatus: 'APPROVED', reviewedAt: now }
    ],
    driverApplications: [
      {
        id: 'u_driver', userId: 'u_driver', status: 'APPROVED', revision: 1,
        summary: {
          legalNameMasked: '林**', identityType: 'MACAU_RESIDENT_ID', identityLast4: '1234',
          driverLicenseLast4: '5678', vehicleType: '七座轿车', passengerCapacity: 7,
          plateMasked: '***28', documentKinds: ['identityFront', 'driverLicense', 'vehicleExterior']
        },
        submittedAt: now, updatedAt: now
      }
    ],
    driverDocumentUploads: [],
    vehicles: [
      { id: 'vehicle_driver_1', driverId: 'u_driver', status: 'ACTIVE', reviewStatus: 'APPROVED', type: '七座轿车', plateMasked: '澳·***28', passengerCapacity: 7 }
    ],
    rideFulfillments: [
      { activityId: 'a_ride', status: 'UNASSIGNED', pickupAt: null, driverId: null, vehicleId: null }
    ],
    applications: [
      {
        id: 'app_ride_member', activityId: 'a_ride', applicantId: 'u_member', applicant: { nickname: '阿同' },
        status: 'PENDING', note: '一个20寸行李箱，时间合适。', autoJoinConsent: true, createdAt: now, updatedAt: now
      },
      {
        id: 'app_buddy_member', activityId: 'a_buddy', applicantId: 'u_member', applicant: { nickname: '阿同' },
        status: 'APPROVED', note: '新手，想一起练习。', autoJoinConsent: true, createdAt: now, updatedAt: now
      }
    ],
    members: [
      { id: 'm_ride_owner', activityId: 'a_ride', userId: 'u_owner', role: 'OWNER', status: 'ACTIVE', joinedAt: now },
      { id: 'm_product_owner', activityId: 'a_product', userId: 'u_merchant', role: 'OWNER', status: 'ACTIVE', joinedAt: now },
      { id: 'm_buddy_owner', activityId: 'a_buddy', userId: 'u_owner', role: 'OWNER', status: 'ACTIVE', joinedAt: now },
      { id: 'm_buddy_member', activityId: 'a_buddy', userId: 'u_member', role: 'MEMBER', status: 'ACTIVE', joinedAt: now }
    ],
    notifications: [
      {
        id: 'n_owner_apply', userId: 'u_owner', type: 'NEW_APPLICATION', activityId: 'a_ride',
        title: '“青茂口岸到凼仔校区同行”有新的加入申请', read: false, createdAt: now,
        url: 'https://untrusted.example/should-not-leak', page: 'untrusted/free-form/path'
      },
      { id: 'n_member_formed', userId: 'u_member', type: 'GROUP_FORMED', activityId: 'a_buddy', title: '“周末新手羽毛球双打”已成团', read: false, createdAt: now }
    ],
    activityQuestions: [
      {
        id: 'q_ride_luggage', activityId: 'a_ride', askerId: 'u_member', asker: { nickname: '阿同' },
        content: '可以带一个20寸行李箱吗？',
        answer: {
          responderId: 'u_owner', responder: { nickname: '小拼' }, content: '可以，请提前说明行李数量。',
          answeredAt: now, operationKeyHash: 'mock-seed-answer'
        },
        submissionKeyHash: 'mock-seed-question', createdAt: now, updatedAt: now
      }
    ],
    reports: [],
    idempotency: {}
  };
}

function readStorage(key) {
  try {
    return typeof wx !== 'undefined' ? wx.getStorageSync(key) : null;
  } catch (error) {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    if (typeof wx !== 'undefined') wx.setStorageSync(key, value);
  } catch (error) {
    // Demo storage failure should not break the in-memory session.
  }
}

let state = readStorage(STATE_KEY) || seedState();
if (!state || state.schemaVersion !== 4) state = seedState();
let currentUserId = readStorage(PERSONA_KEY) || 'u_owner';
if (!state.idempotency) state.idempotency = {};
if (!state.activityQuestions) state.activityQuestions = [];
if (!state.drivers) state.drivers = [];
if (!state.vehicles) state.vehicles = [];
if (!state.rideFulfillments) state.rideFulfillments = [];
if (!state.driverApplications) state.driverApplications = [];
if (!state.driverDocumentUploads) state.driverDocumentUploads = [];

function persist() {
  writeStorage(STATE_KEY, state);
  writeStorage(PERSONA_KEY, currentUserId);
}

function nextId(prefix) {
  state.sequence += 1;
  return `${prefix}_${state.sequence}`;
}

function userById(id) {
  return state.users.find((item) => item.id === id);
}

function activityById(id) {
  return state.activities.find((item) => item.id === id);
}

function activeMember(activityId, userId) {
  return state.members.find((item) => item.activityId === activityId && item.userId === userId && item.status === 'ACTIVE');
}

function isMockRideJoinable(activity, at) {
  if (!activity || activity.type !== 'ride') return false;
  if (!['RECRUITING', 'FORMED'].includes(activity.status)) return false;
  if (activity.memberCount >= 7) return false;
  if (Date.parse(activity.deadlineAt) <= Date.parse(at)) return false;
  return true;
}

function isMockRideAcceptable(activity, at) {
  if (!activity || activity.type !== 'ride' || !['RECRUITING', 'FORMED'].includes(activity.status)) return false;
  const fulfillment = (state.rideFulfillments || []).find((item) => item.activityId === activity.id);
  if (!fulfillment || fulfillment.status !== 'UNASSIGNED') return false;
  return Date.parse(activity.typeData && activity.typeData.pickupWindowEnd) > Date.parse(at);
}

function publicUser(user) {
  return user ? {
    role: user.role,
    status: user.status,
    onboarding: user.onboarding ? clone(user.onboarding) : { roleIntent: null, completedAt: null },
    profile: clone(user.profile)
  } : null;
}

function publicDriverApplication(application) {
  if (!application) return null;
  return clone({
    status: application.status,
    revision: application.revision,
    summary: application.summary,
    submittedAt: application.submittedAt,
    updatedAt: application.updatedAt,
    review: application.review ? { reasonCode: application.review.reasonCode || '', reviewedAt: application.review.reviewedAt } : null
  });
}

function publicApplication(application) {
  return {
    id: application.id,
    status: application.status,
    note: application.note || '',
    autoJoinConsent: application.autoJoinConsent === true,
    applicant: application.applicant && application.applicant.nickname
      ? { nickname: application.applicant.nickname }
      : null,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
    approvedAt: application.approvedAt
  };
}

function publicNotification(notification) {
  return clone({
    id: notification.id,
    type: notification.type,
    target: resolveNotificationTarget(notification.type),
    activityId: notification.activityId,
    title: notification.title,
    read: notification.read === true,
    createdAt: notification.createdAt,
    readAt: notification.readAt
  });
}

function publicActivityQuestion(question) {
  return clone({
    id: question.id,
    activityId: question.activityId,
    content: question.content,
    asker: question.asker && question.asker.nickname ? { nickname: question.asker.nickname } : null,
    answer: question.answer
      ? {
          content: question.answer.content,
          responder: question.answer.responder && question.answer.responder.nickname
            ? { nickname: question.answer.responder.nickname }
            : null,
          answeredAt: question.answer.answeredAt
        }
      : null,
    createdAt: question.createdAt,
    updatedAt: question.updatedAt
  });
}

function publicActivity(activity, options = {}) {
  const anonymous = options && options.anonymous === true;
  const viewerApplication = anonymous
    ? null
    : state.applications
      .filter((item) => item.activityId === activity.id && item.applicantId === currentUserId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const viewerMember = anonymous ? null : activeMember(activity.id, currentUserId);
  const viewerFulfillment = activity.type === 'ride'
    ? (state.rideFulfillments || []).find((item) => item.activityId === activity.id)
    : null;
  const viewerRole = anonymous
    ? 'guest'
    : activity.ownerId === currentUserId
      ? 'owner'
      : viewerMember
        ? 'member'
        : viewerFulfillment && viewerFulfillment.status === 'ASSIGNED' && viewerFulfillment.driverId === currentUserId
          ? 'driver'
          : viewerApplication ? 'applicant' : 'guest';
  const { contactInfo, ownerId, version, suspension, operationKeyHash, ...safe } = activity;
  const rideCapacity = activity.type === 'ride' ? 7 : (activity.maxPassengers || activity.targetMembers);
  const result = {
    ...clone(safe),
    targetMembers: activity.type === 'ride' ? 7 : activity.targetMembers,
    minPassengers: activity.type === 'ride' ? 7 : (activity.minPassengers || activity.targetMembers),
    maxPassengers: rideCapacity,
    remainingCapacity: Math.max(0, Number(rideCapacity) - Number(activity.memberCount || 0)),
    status: activity.type === 'ride' && ['RECRUITING', 'FORMED'].includes(activity.status)
      ? (activity.memberCount >= 7 ? 'FORMED' : 'RECRUITING')
      : activity.status,
    viewerRole
  };
  if (activity.type === 'ride') {
    const fulfillment = (state.rideFulfillments || []).find((item) => item.activityId === activity.id);
    result.rideFulfillment = fulfillment ? {
      status: fulfillment.status,
      pickupAt: fulfillment.pickupAt || null,
      assignedAt: fulfillment.assignedAt || null
    } : null;
    if (fulfillment) {
      const driver = fulfillment.driverId && userById(fulfillment.driverId);
      const vehicle = fulfillment.vehicleId && (state.vehicles || []).find((item) => item.id === fulfillment.vehicleId);
      if (driver) result.rideFulfillment.driver = { nickname: driver.profile.nickname };
      if (vehicle) result.rideFulfillment.vehicle = { type: vehicle.type, plateMasked: vehicle.plateMasked };
    }
    result.rideJoinable = isMockRideJoinable(activity, new Date().toISOString());
    result.canJoinRide = result.rideJoinable && (viewerRole === 'guest' || viewerRole === 'applicant');
    result.canLeaveRide = viewerRole === 'member' && Boolean(fulfillment && fulfillment.status === 'UNASSIGNED');
    result.rideExitLocked = viewerRole === 'member' && Boolean(fulfillment && fulfillment.status !== 'UNASSIGNED');
    result.driverAcceptable = isMockRideAcceptable(activity, new Date().toISOString());
    result.driverUnacceptableReason = result.driverAcceptable
      ? ''
      : fulfillment && fulfillment.status === 'ASSIGNED'
        ? '该行程已有司机确认'
        : '接车时间已到，暂不可承接';
  }
  if (viewerApplication) result.viewerApplication = publicApplication(viewerApplication);
  if (viewerMember) result.viewerMembership = clone(viewerMember);
  return result;
}

function fail(code, message, details) {
  return { ok: false, error: { code, message, ...(details ? { details } : {}) } };
}

function ok(data) {
  persist();
  return { ok: true, data };
}

function requireUser() {
  const user = userById(currentUserId);
  if (!user) throw fail('UNAUTHENTICATED', '请先登录后再操作');
  if (user.status !== 'ACTIVE') throw fail('ACCOUNT_DISABLED', '账号已被限制，请联系平台处理');
  return user;
}

function assert(condition, code, message, details) {
  if (!condition) throw fail(code, message, details);
}

function normalizedContent(value, field, min, max) {
  const content = typeof value === 'string' ? value.trim() : '';
  assert(content.length >= min && content.length <= max, 'VALIDATION_ERROR', `${field}长度不符合要求`);
  return content;
}

function validatedId(value, field) {
  const id = typeof value === 'string' ? value.trim() : '';
  assert(id.length >= 1 && id.length <= 80, 'VALIDATION_ERROR', `${field}格式无效`);
  return id;
}

function optionalFilterString(value, field, max) {
  if (value === undefined || value === null || value === '') return '';
  assert(typeof value === 'string', 'VALIDATION_ERROR', `${field}格式无效`, { field });
  const normalized = value.trim();
  assert(normalized.length <= max, 'VALIDATION_ERROR', `${field}长度不能超过${max}个字符`, { field });
  return normalized;
}

function validateActivityListFilters(input) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'VALIDATION_ERROR', '筛选条件格式无效');
  const type = optionalFilterString(input.type, '活动类型', 20);
  const city = optionalFilterString(input.city, '城市', 20) || PILOT_CITY;
  const district = optionalFilterString(input.district, '行政区', 30);
  const keyword = optionalFilterString(input.keyword, '搜索词', 30);
  const routeId = optionalFilterString(input.routeId, '固定路线', 40);
  const campusId = optionalFilterString(input.campusId, '校区', 40);
  const viewMode = optionalFilterString(input.viewMode, '浏览视角', 20) || 'passenger';
  assert(!type || ACTIVITY_TYPES.includes(type), 'VALIDATION_ERROR', '活动类型选项无效', { field: '活动类型' });
  assert(city === PILOT_CITY, 'VALIDATION_ERROR', '当前仅支持澳门试点', { field: 'city' });
  assert(!district || PILOT_DISTRICTS.includes(district), 'VALIDATION_ERROR', '行政区选项无效', { field: '行政区' });
  assert(!routeId || getRideRoute(routeId), 'VALIDATION_ERROR', '固定路线选项无效', { field: '固定路线' });
  assert(!campusId || ['TAIPA_CAMPUS', 'GOLDEN_DRAGON_CAMPUS'].includes(campusId), 'VALIDATION_ERROR', '校区选项无效', { field: '校区' });
  assert(['passenger', 'driver'].includes(viewMode), 'VALIDATION_ERROR', '浏览视角选项无效');
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

function moderateContent(content) {
  assert(!/先付定金|司机接单|包赚|稳赚|返利|陪玩交易|援交/i.test(content), 'CONTENT_REJECTED', '内容未通过安全检查，请修改后重试');
}

function questionActivity(activityId) {
  const activity = normalizeActivityForRead(activityById(activityId), new Date().toISOString());
  assert(activity, 'NOT_FOUND', '活动不存在或已失效');
  assert(activity.status !== 'SUSPENDED', 'TAKEDOWN', '该活动已被平台处理，暂不可查看');
  return activity;
}

function listActivityQuestions(input) {
  const activityId = validatedId(input && input.activityId, '活动ID');
  const activity = questionActivity(activityId);
  assert(activity.status !== 'DRAFT', 'NOT_FOUND', '活动不存在或已失效');
  const cursor = parsePublicCursor(input.cursor);
  const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 10);
  const items = state.activityQuestions
    .filter((item) => item.activityId === activity.id)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const page = items.slice(cursor, cursor + limit + 1);
  return {
    items: page.slice(0, limit).map(publicActivityQuestion),
    nextCursor: page.length > limit ? String(cursor + limit) : null
  };
}

function askActivityQuestion(input) {
  const user = requireUser();
  const activityId = validatedId(input && input.activityId, '活动ID');
  const content = normalizedContent(input && input.content, '问题内容', 2, 200);
  const activity = questionActivity(activityId);
  assert(['RECRUITING', 'FORMED'].includes(activity.status), 'CONFLICT', '该活动当前不能提问');
  moderateContent(content);
  const now = new Date().toISOString();
  const question = {
    id: nextId('question'),
    activityId: activity.id,
    askerId: user.id,
    asker: user.profile && user.profile.nickname ? { nickname: user.profile.nickname } : null,
    content,
    answer: null,
    submissionKeyHash: 'mock-operation',
    createdAt: now,
    updatedAt: now
  };
  state.activityQuestions.push(question);
  return { question: publicActivityQuestion(question) };
}

function answerActivityQuestion(input) {
  const user = requireUser();
  const activityId = validatedId(input && input.activityId, '活动ID');
  const questionId = validatedId(input && input.questionId, '问题ID');
  const content = normalizedContent(input && input.content, '回答内容', 1, 300);
  const activity = questionActivity(activityId);
  assert(activity.ownerId === user.id, 'FORBIDDEN', '仅活动发起者可以回答');
  assert(['RECRUITING', 'FORMED', 'IN_PROGRESS'].includes(activity.status), 'CONFLICT', '该活动当前不能回答问题');
  moderateContent(content);
  const question = state.activityQuestions.find((item) => item.id === questionId && item.activityId === activity.id);
  assert(question, 'NOT_FOUND', '问题不存在或已失效');
  assert(!question.answer, 'CONFLICT', '该问题已经回答');
  const now = new Date().toISOString();
  question.answer = {
    responderId: user.id,
    responder: user.profile && user.profile.nickname ? { nickname: user.profile.nickname } : null,
    content,
    answeredAt: now,
    operationKeyHash: 'mock-operation'
  };
  question.updatedAt = now;
  return { question: publicActivityQuestion(question) };
}

function listActivities(input) {
  const filters = validateActivityListFilters(input);
  const now = new Date().toISOString();
  let candidates = state.activities.filter((item) => ['RECRUITING', 'FORMED'].includes(item.status));
  if (filters.type) candidates = candidates.filter((item) => item.type === filters.type);
  candidates = candidates.filter((item) => item.city === filters.city);
  if (filters.district) candidates = candidates.filter((item) => item.district === filters.district);
  if (filters.routeId) candidates = candidates.filter(
    (item) => item.type === 'ride' && item.typeData && item.typeData.routeId === filters.routeId
  );
  if (filters.campusId) {
    const campusRouteIds = RIDE_ROUTES
      .filter((route) => route.originId === filters.campusId || route.destinationId === filters.campusId)
      .map((route) => route.id);
    candidates = candidates.filter(
      (item) => item.type === 'ride' && item.typeData && campusRouteIds.includes(item.typeData.routeId)
    );
  }
  candidates.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  const offset = parsePublicCursor(input.cursor);
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);
  const keyword = filters.keyword ? filters.keyword.toLowerCase() : '';
  const items = [];
  let rawOffset = offset;
  let scanned = 0;

  while (rawOffset < candidates.length && scanned < MAX_PUBLIC_SCAN) {
    const candidateOffset = rawOffset;
    const activity = normalizeActivityForRead(candidates[rawOffset], now);
    rawOffset += 1;
    scanned += 1;
    const keywordMatch = !keyword || `${activity.title} ${activity.description}`.toLowerCase().includes(keyword);
    const viewMatch = filters.viewMode === 'driver'
      ? isMockRideAcceptable(activity, now)
      : activity.type !== 'ride' || isMockRideJoinable(activity, now);
    if (['RECRUITING', 'FORMED'].includes(activity.status) && keywordMatch && viewMatch) {
      if (items.length === limit) {
        return {
          items: items.map((item) => publicActivity(item, { anonymous: true })),
          nextCursor: String(candidateOffset)
        };
      }
      items.push(activity);
    }
  }

  return {
    items: items.map((item) => publicActivity(item, { anonymous: true })),
    nextCursor: rawOffset < candidates.length ? String(rawOffset) : null
  };
}

function createActivity(input) {
  const user = requireUser();
  assert(user.profile && user.profile.adultConfirmed, 'PROFILE_INCOMPLETE', '请先完成成年确认和基本资料');
  const now = new Date().toISOString();
  const activity = {
    id: nextId('activity'), ownerId: user.id, owner: { nickname: user.profile.nickname },
    ...clone(input), memberCount: 1, status: 'RECRUITING', version: 1, createdAt: now, updatedAt: now
  };
  if (activity.type === 'ride') {
    const route = getRideRoute(activity.typeData && activity.typeData.routeId);
    assert(route, 'VALIDATION_ERROR', '请选择固定路线');
    const startsAt = Date.parse(activity.startsAt);
    const deadlineAt = Date.parse(activity.deadlineAt);
    const pickupWindowEnd = Date.parse(activity.typeData && activity.typeData.pickupWindowEnd);
    const minPassengers = Number(activity.minPassengers);
    const maxPassengers = Number(activity.maxPassengers);
    assert(Number.isFinite(startsAt) && startsAt > Date.parse(now), 'VALIDATION_ERROR', '出发时间必须晚于当前时间');
    assert(startsAt <= Date.parse(now) + 7 * 24 * 60 * 60 * 1000, 'VALIDATION_ERROR', '出发时间最多可选择未来 7 天');
    assert(new Date(startsAt).getMinutes() % 15 === 0, 'VALIDATION_ERROR', '出发时间需按 15 分钟选择');
    assert(Number.isFinite(deadlineAt) && deadlineAt > Date.parse(now) && deadlineAt < startsAt, 'VALIDATION_ERROR', '报名截止时间无效');
    assert(minPassengers === 7, 'VALIDATION_ERROR', '成团人数固定为 7 名乘客');
    assert(maxPassengers === 7, 'VALIDATION_ERROR', '最大乘客数固定为 7 名乘客');
    assert(Number.isFinite(pickupWindowEnd) && pickupWindowEnd - startsAt === 60 * 60 * 1000, 'VALIDATION_ERROR', '接车时间窗必须为 60 分钟');
    assert(['FREE', 'SHARED_COST', 'NO_COST'].includes(activity.typeData.feeType), 'VALIDATION_ERROR', '费用方式无效');
    assert(['NO_LARGE', 'ONE_SMALL', 'TRUNK_OK'].includes(activity.typeData.luggageRule), 'VALIDATION_ERROR', '行李规则无效');
    assert(!hasRidePrice([activity.title, activity.description, activity.rules].join(' ')), 'VALIDATION_ERROR', '拼车仅允许合理成本均摊，不能填写具体收费金额');
    activity.city = PILOT_CITY;
    activity.district = PILOT_DISTRICTS[0];
    activity.placeLabel = `${route.origin} → ${route.destination}`;
    activity.targetMembers = 7;
    activity.minPassengers = 7;
    activity.maxPassengers = 7;
    activity.typeData = {
      ...activity.typeData,
      routeCode: route.code,
      origin: { id: route.originId, label: route.origin },
      destination: { id: route.destinationId, label: route.destination }
    };
    state.rideFulfillments.push({ activityId: activity.id, status: 'UNASSIGNED', pickupAt: null, driverId: null, vehicleId: null });
  }
  state.activities.unshift(activity);
  state.members.push({ id: nextId('member'), activityId: activity.id, userId: user.id, role: 'OWNER', status: 'ACTIVE', joinedAt: now });
  return { activity: publicActivity(activity) };
}

function driverProfile() {
  const user = requireUser();
  const driver = (state.drivers || []).find((item) => item.userId === user.id);
  if (!driver) return { canAcceptRide: false, vehicles: [] };
  return {
    canAcceptRide: driver.status === 'ACTIVE' && driver.reviewStatus === 'APPROVED',
    vehicles: (state.vehicles || [])
      .filter((item) => item.driverId === user.id)
      .map((item) => ({
        id: item.id,
        canUseForRide: item.status === 'ACTIVE' && item.reviewStatus === 'APPROVED',
        type: item.type,
        plateMasked: item.plateMasked,
        passengerCapacity: item.passengerCapacity
      }))
  };
}

function acceptRide(input) {
  const user = requireUser();
  const driver = (state.drivers || []).find((item) => item.userId === user.id);
  assert(driver && driver.status === 'ACTIVE' && driver.reviewStatus === 'APPROVED', 'DRIVER_NOT_APPROVED', '司机资格尚未通过审核');
  const vehicle = (state.vehicles || []).find((item) => item.id === input.vehicleId && item.driverId === user.id);
  assert(vehicle && vehicle.status === 'ACTIVE' && vehicle.reviewStatus === 'APPROVED', 'VEHICLE_NOT_APPROVED', '车辆尚未通过审核');
  assert(Number(vehicle.passengerCapacity) >= 7, 'VEHICLE_NOT_APPROVED', '车辆核定乘客容量不足');
  const activity = activityById(input.activityId);
  assert(activity && activity.type === 'ride', 'NOT_FOUND', '行程不存在');
  assert(!activeMember(activity.id, user.id), 'FORBIDDEN', '同一行程不能同时作为司机和乘客');
  assert(['RECRUITING', 'FORMED'].includes(activity.status), 'CONFLICT', '当前行程暂不可承接');
  const fulfillment = (state.rideFulfillments || []).find((item) => item.activityId === activity.id);
  assert(fulfillment && fulfillment.status === 'UNASSIGNED', 'RIDE_ALREADY_ASSIGNED', '该行程刚刚已被其他司机承接');
  const pickupAt = new Date(input.pickupAt);
  const windowStart = Date.parse(activity.startsAt);
  const windowEnd = Date.parse(activity.typeData.pickupWindowEnd);
  assert(windowEnd > Date.now(), 'PICKUP_TIME_EXPIRED', '接车时间已过，无法承接');
  assert(Number.isFinite(pickupAt.getTime())
    && windowEnd - windowStart === 60 * 60 * 1000
    && pickupAt.getTime() > Date.now()
    && pickupAt.getMinutes() % 15 === 0
    && pickupAt.getTime() >= windowStart
    && pickupAt.getTime() < windowEnd, 'INVALID_PICKUP_SLOT', '请在期望时间窗内按 15 分钟选择');
  const now = new Date().toISOString();
  fulfillment.status = 'ASSIGNED';
  fulfillment.driverId = user.id;
  fulfillment.vehicleId = vehicle.id;
  fulfillment.pickupAt = pickupAt.toISOString();
  fulfillment.assignedAt = now;
  fulfillment.cancelledAt = null;
  activity.rideFulfillment = { status: 'ASSIGNED', pickupAt: fulfillment.pickupAt };
  activity.targetMembers = 7;
  activity.minPassengers = 7;
  activity.maxPassengers = 7;
  activity.status = activity.memberCount >= 7 ? 'FORMED' : 'RECRUITING';
  activity.rideJoinable = isMockRideJoinable(activity, now);
  activity.updatedAt = now;
  return { activity: publicActivity(activity), fulfillment: clone(publicActivity(activity).rideFulfillment) };
}

function cancelRideAssignment(input) {
  const user = requireUser();
  const activity = activityById(input.activityId);
  const fulfillment = activity && (state.rideFulfillments || []).find((item) => item.activityId === activity.id);
  assert(activity && fulfillment, 'NOT_FOUND', '行程不存在');
  assert(fulfillment.status === 'ASSIGNED' && fulfillment.driverId === user.id, 'FORBIDDEN', '你不能取消该行程的司机承接');
  const now = new Date().toISOString();
  fulfillment.status = 'UNASSIGNED';
  fulfillment.cancelledAt = now;
  fulfillment.cancelReason = input.reason || '';
  fulfillment.previousDriverId = user.id;
  fulfillment.driverId = null;
  fulfillment.vehicleId = null;
  fulfillment.pickupAt = null;
  fulfillment.assignedAt = null;
  activity.rideFulfillment = { status: 'UNASSIGNED', pickupAt: null };
  activity.rideJoinable = isMockRideJoinable(activity, now);
  activity.updatedAt = now;
  return { activity: publicActivity(activity), fulfillment: clone(publicActivity(activity).rideFulfillment) };
}

function submitApplication(input) {
  const user = requireUser();
  const activity = activityById(input.activityId);
  assert(activity, 'NOT_FOUND', '活动不存在或已失效');
  const now = new Date().toISOString();
  assert(
    activity.type === 'ride' ? isMockRideJoinable(activity, now) : activity.status === 'RECRUITING',
    'CONFLICT',
    '该行程当前不可申请'
  );
  assert(activity.ownerId !== user.id, 'CONFLICT', '不能申请自己发布的活动');
  assert(Date.parse(activity.deadlineAt) > Date.parse(now), 'CONFLICT', '该活动报名已截止');
  assert(input.autoJoinConsent === true, 'VALIDATION_ERROR', '请确认获批后自动加入并占用名额');
  const duplicate = state.applications.find((item) => item.activityId === input.activityId && item.applicantId === user.id && ['PENDING', 'APPROVED'].includes(item.status));
  assert(!duplicate, 'CONFLICT', '你已经申请或加入该活动');
  const application = {
    id: nextId('application'), activityId: input.activityId, applicantId: user.id,
    applicant: { nickname: user.profile.nickname }, status: 'PENDING', note: input.note || '', autoJoinConsent: true,
    createdAt: now, updatedAt: now
  };
  state.applications.push(application);
  state.notifications.unshift({ id: nextId('notification'), userId: activity.ownerId, type: 'NEW_APPLICATION', activityId: activity.id, title: `“${activity.title}”有新的加入申请`, read: false, createdAt: now });
  return { application: publicApplication(application) };
}

function joinRide(input) {
  const user = requireUser();
  const activity = activityById(input.activityId);
  const fulfillment = activity && (state.rideFulfillments || []).find((item) => item.activityId === activity.id);
  assert(activity && activity.type === 'ride' && fulfillment, 'NOT_FOUND', '行程不存在或已失效');
  assert(activity.ownerId !== user.id, 'CONFLICT', '发起者已经在行程中');
  assert(fulfillment.driverId !== user.id, 'FORBIDDEN', '同一行程不能同时作为司机和乘客');
  const existing = state.members.find((item) => item.activityId === activity.id && item.userId === user.id);
  if (existing && existing.status === 'ACTIVE') return { activity: publicActivity(activity) };
  const now = new Date().toISOString();
  assert(isMockRideJoinable(activity, now), activity.memberCount >= 7 ? 'CAPACITY_FULL' : 'CONFLICT', '该行程当前不可加入');
  const member = existing || { id: nextId('member'), activityId: activity.id, userId: user.id, role: 'MEMBER' };
  member.status = 'ACTIVE';
  member.joinedAt = now;
  delete member.leftAt;
  delete member.leaveReason;
  if (!existing) state.members.push(member);
  activity.memberCount += 1;
  activity.status = activity.memberCount >= 7 ? 'FORMED' : 'RECRUITING';
  if (activity.status === 'FORMED') activity.formedAt = activity.formedAt || now;
  activity.rideJoinable = isMockRideJoinable(activity, now);
  activity.updatedAt = now;
  activity.version += 1;
  const legacy = state.applications.find((item) => item.activityId === activity.id && item.applicantId === user.id);
  if (legacy) Object.assign(legacy, { status: 'APPROVED', approvedAt: now, updatedAt: now });
  state.notifications.unshift({ id: nextId('notification'), userId: activity.ownerId, type: 'RIDE_MEMBER_JOINED', activityId: activity.id, title: `有新乘客加入“${activity.title}”`, read: false, createdAt: now });
  return { activity: publicActivity(activity) };
}

function approveApplication(input) {
  const activity = activityById(input.activityId);
  const application = state.applications.find((item) => item.id === input.applicationId);
  assert(activity && application, 'NOT_FOUND', '申请不存在');
  assert(activity.ownerId === currentUserId, 'FORBIDDEN', '你没有权限处理该申请');
  if (application.status === 'APPROVED') {
    return { activity: publicActivity(activity), application: publicApplication(application) };
  }
  const now = new Date().toISOString();
  assert(Date.parse(activity.deadlineAt) > Date.parse(now), 'CONFLICT', '该活动报名已截止');
  if (activity.type === 'ride' && activity.status === 'FORMED') {
    assert(Date.parse(activity.typeData && activity.typeData.pickupWindowEnd) > Date.parse(now), 'CONFLICT', '该行程接车时间窗已结束');
  }
  assert(
    activity.type === 'ride' ? isMockRideJoinable(activity, now) : activity.status === 'RECRUITING',
    'CONFLICT',
    '行程当前不可继续批准乘客'
  );
  assert(application.status === 'PENDING', 'CONFLICT', '该申请已处理');
  const capacity = activity.type === 'ride' ? 7 : activity.targetMembers;
  assert(activity.memberCount < capacity, 'CAPACITY_FULL', '名额已满');
  application.status = 'APPROVED';
  application.approvedAt = now;
  application.updatedAt = now;
  state.members.push({ id: nextId('member'), activityId: activity.id, userId: application.applicantId, role: 'MEMBER', status: 'ACTIVE', joinedAt: now });
  activity.memberCount += 1;
  activity.version += 1;
  activity.updatedAt = now;
  const justFormed = activity.status === 'RECRUITING' && activity.memberCount >= (activity.type === 'ride' ? 7 : activity.targetMembers);
  if (justFormed) {
    activity.status = 'FORMED';
    activity.formedAt = now;
  }
  if (activity.memberCount >= capacity) {
    state.applications.forEach((item) => {
      if (item.activityId === activity.id && item.status === 'PENDING') item.status = 'CANCELLED_BY_ACTIVITY';
    });
  }
  if (activity.type === 'ride') activity.rideJoinable = isMockRideJoinable(activity, now);
  state.notifications.unshift({
    id: nextId('notification'), userId: application.applicantId,
    type: justFormed ? 'GROUP_FORMED' : 'APPLICATION_APPROVED', activityId: activity.id,
    title: justFormed ? `“${activity.title}”已满员并成团` : `你已加入“${activity.title}”`, read: false, createdAt: now
  });
  return { activity: publicActivity(activity), application: publicApplication(application) };
}

function handle(action, input, idempotencyKey = '') {
  if (!PUBLIC_ACTIONS.has(action)) requireUser();
  if (action === 'auth.login') {
    const user = requireUser();
    const application = state.driverApplications.find((item) => item.userId === user.id);
    return {
      user: publicUser(user),
      onboarding: {
        profileComplete: Boolean(user.profile && user.profile.adultConfirmed),
        roleIntent: user.onboarding && user.onboarding.roleIntent || null,
        driverApplication: publicDriverApplication(application)
      },
      sessionScope: `mock-session-${currentUserId}`
    };
  }
  if (action === 'profile.get') return { user: publicUser(requireUser()) };
  if (action === 'profile.update') {
    const user = requireUser();
    user.profile = clone(input);
    return { user: publicUser(user) };
  }
  if (action === 'onboarding.selectRole') {
    const user = requireUser();
    assert(['PASSENGER', 'DRIVER'].includes(input.roleIntent), 'VALIDATION_ERROR', '注册身份无效');
    user.onboarding = { roleIntent: input.roleIntent, completedAt: new Date().toISOString() };
    return { user: publicUser(user) };
  }
  if (action === 'driver.application.get') {
    const application = state.driverApplications.find((item) => item.userId === currentUserId);
    return { application: publicDriverApplication(application) };
  }
  if (action === 'driver.document.prepare') {
    assert(['identityFront', 'driverLicense', 'vehicleExterior'].includes(input.kind), 'VALIDATION_ERROR', '文件类型无效');
    const upload = {
      id: nextId('driver_upload'), userId: currentUserId, kind: input.kind,
      cloudPath: `mock-private/${currentUserId}/${Date.now()}-${input.kind}.jpg`,
      status: 'PREPARED', expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    };
    state.driverDocumentUploads.push(upload);
    return { upload: { id: upload.id, kind: upload.kind, cloudPath: upload.cloudPath, expiresAt: upload.expiresAt } };
  }
  if (action === 'driver.document.confirm') {
    const upload = state.driverDocumentUploads.find((item) => item.id === input.uploadId);
    assert(upload && upload.userId === currentUserId && upload.kind === input.kind && ['PREPARED', 'INSPECTED'].includes(upload.status), 'DRIVER_DOCUMENT_REQUIRED', '认证图片无效');
    assert(input.fileID === upload.cloudPath, 'DRIVER_DOCUMENT_REQUIRED', '文件与上传凭据不匹配');
    if (upload.status === 'INSPECTED') return { document: { uploadId: upload.id, kind: upload.kind, inspectedAt: upload.inspectedAt } };
    upload.status = 'INSPECTED';
    upload.sealedFileID = `mock-sealed://${upload.id}`;
    upload.inspectedAt = new Date().toISOString();
    return { document: { uploadId: upload.id, kind: upload.kind, inspectedAt: upload.inspectedAt } };
  }
  if (action === 'driver.application.submit') {
    const current = state.driverApplications.find((item) => item.userId === currentUserId);
    const payloadHash = opaqueSensitiveHash(stableSerialize(input));
    if (current && current.operationKeyHash === idempotencyKey) {
      assert(current.payloadHash === payloadHash, 'CONFLICT', '幂等键已用于其他司机认证资料');
      return { application: publicDriverApplication(current) };
    }
    assert(!current || !['SUBMITTED', 'APPROVED'].includes(current.status), 'DRIVER_APPLICATION_PENDING', '司机认证正在审核中');
    assert(input.consent && input.consent.driverVerify === true && input.consent.sensitiveDocuments === true, 'DRIVER_CONSENT_REQUIRED', '请同意资料使用说明');
    const required = ['legalName', 'identityType', 'identityNumber', 'driverLicenseNumber', 'vehicleType', 'plateNumber'];
    required.forEach((field) => assert(String(input[field] || '').trim(), 'VALIDATION_ERROR', '请补齐司机认证资料'));
    const documents = input.documents || {};
    ['identityFront', 'driverLicense', 'vehicleExterior'].forEach((kind) => {
      const reference = documents[kind];
      const upload = reference && state.driverDocumentUploads.find((item) => item.id === reference.uploadId);
      assert(upload && upload.userId === currentUserId && upload.kind === kind && upload.status === 'INSPECTED', 'DRIVER_DOCUMENT_REQUIRED', '请补齐司机认证图片');
      upload.status = 'BOUND';
    });
    const now = new Date().toISOString();
    const application = {
      id: currentUserId,
      userId: currentUserId,
      status: 'SUBMITTED',
      revision: Number(current && current.revision || 0) + 1,
      operationKeyHash: idempotencyKey,
      payloadHash,
      summary: {
        legalNameMasked: `${String(input.legalName).slice(0, 1)}**`,
        identityType: input.identityType,
        identityLast4: String(input.identityNumber).slice(-4),
        identityExpiresAt: input.identityExpiresAt,
        driverLicenseLast4: String(input.driverLicenseNumber).slice(-4),
        driverLicenseExpiresAt: input.driverLicenseExpiresAt,
        vehicleType: input.vehicleType,
        passengerCapacity: Number(input.passengerCapacity),
        plateMasked: `***${String(input.plateNumber).slice(-2)}`,
        documentKinds: Object.keys(documents)
      },
      submittedAt: now,
      updatedAt: now
    };
    if (current) Object.assign(current, application);
    else state.driverApplications.push(application);
    return { application: publicDriverApplication(application) };
  }
  if (action === 'driver.application.withdraw') {
    const application = state.driverApplications.find((item) => item.userId === currentUserId);
    assert(application && ['SUBMITTED', 'NEEDS_MORE_INFO'].includes(application.status), 'DRIVER_APPLICATION_LOCKED', '当前认证状态不能撤回');
    application.status = 'WITHDRAWN';
    application.updatedAt = new Date().toISOString();
    const retentionUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    state.driverDocumentUploads.forEach((upload) => {
      if (upload.userId === currentUserId && upload.status === 'BOUND') {
        upload.status = 'RETENTION_PENDING';
        upload.retentionUntil = retentionUntil;
      }
    });
    return { application: publicDriverApplication(application) };
  }
  if (action === 'activity.list') return listActivities(input);
  if (action === 'activity.detail') {
    const activity = normalizeActivityForRead(activityById(input.activityId), new Date().toISOString());
    assert(activity, 'NOT_FOUND', '活动不存在或已失效');
    assert(activity.status !== 'SUSPENDED', 'TAKEDOWN', '该活动已被平台处理，暂不可查看');
    return { activity: publicActivity(activity) };
  }
  if (action === 'activity.question.list') return listActivityQuestions(input);
  if (action === 'activity.question.ask') return askActivityQuestion(input);
  if (action === 'activity.question.answer') return answerActivityQuestion(input);
  if (action === 'activity.mine') {
    const user = requireUser();
    const joinedIds = state.members.filter((item) => item.userId === user.id && item.role === 'MEMBER' && item.status === 'ACTIVE').map((item) => item.activityId);
    return {
      owned: state.activities.filter((item) => item.ownerId === user.id).map(publicActivity),
      joined: state.activities.filter((item) => joinedIds.includes(item.id)).map(publicActivity)
    };
  }
  if (action === 'activity.create') return createActivity(input);
  if (action === 'ride.driver.profile') return { driver: driverProfile() };
  if (action === 'ride.driver.mine') {
    requireUser();
    return {
      items: (state.rideFulfillments || [])
        .filter((item) => item.driverId === currentUserId && item.status === 'ASSIGNED')
        .map((item) => ({
          activity: publicActivity(activityById(item.activityId)),
          rideFulfillment: clone(publicActivity(activityById(item.activityId)).rideFulfillment)
        }))
    };
  }
  if (action === 'ride.driver.accept') return acceptRide(input);
  if (action === 'ride.driver.cancel') return cancelRideAssignment(input);
  if (action === 'application.submit') return submitApplication(input);
  if (action === 'ride.join') return joinRide(input);
  if (action === 'application.listForOwner') {
    const activity = activityById(input.activityId);
    assert(activity && activity.ownerId === currentUserId, 'FORBIDDEN', '你没有权限查看申请');
    return {
      items: state.applications
        .filter((item) => item.activityId === input.activityId)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .map(publicApplication)
    };
  }
  if (action === 'application.approve') return approveApplication(input);
  if (action === 'application.reject') {
    const application = state.applications.find((item) => item.id === input.applicationId);
    const activity = application && activityById(application.activityId);
    assert(activity && activity.ownerId === currentUserId, 'FORBIDDEN', '你没有权限处理该申请');
    assert(application.status === 'PENDING', 'CONFLICT', '该申请已处理');
    application.status = 'REJECTED';
    application.updatedAt = new Date().toISOString();
    return { activity: publicActivity(activity), application: publicApplication(application) };
  }
  if (action === 'application.withdraw') {
    const application = state.applications.find((item) => item.id === input.applicationId);
    assert(application && application.applicantId === currentUserId, 'FORBIDDEN', '你没有权限撤回该申请');
    assert(application.status === 'PENDING', 'CONFLICT', '当前状态不能撤回申请');
    application.status = 'WITHDRAWN';
    application.updatedAt = new Date().toISOString();
    return { application: publicApplication(application) };
  }
  if (action === 'member.leave') {
    const activity = activityById(input.activityId);
    const member = activeMember(input.activityId, currentUserId);
    assert(activity && member && member.role !== 'OWNER', 'FORBIDDEN', '当前不能退出该活动');
    assert(['RECRUITING', 'FORMED'].includes(activity.status), 'CONFLICT', '当前状态不能退团');
    const fulfillment = activity.type === 'ride'
      ? (state.rideFulfillments || []).find((item) => item.activityId === activity.id)
      : null;
    assert(
      activity.type !== 'ride' || !fulfillment || fulfillment.status === 'UNASSIGNED',
      'RIDE_MEMBER_LOCKED',
      '司机已确认承接，当前不可退出拼车'
    );
    member.status = 'LEFT';
    member.leaveReason = input.reason || '';
    const now = new Date().toISOString();
    member.leftAt = now;
    activity.memberCount = Math.max(1, activity.memberCount - 1);
    if (activity.status === 'FORMED' && activity.memberCount < (activity.minPassengers || activity.targetMembers)) {
      activity.status = 'RECRUITING';
      delete activity.formedAt;
    }
    activity.updatedAt = now;
    if (activity.type === 'ride') activity.rideJoinable = isMockRideJoinable(activity, now);
    return { activity: publicActivity(activity) };
  }
  if (action === 'activity.cancel') {
    const activity = activityById(input.activityId);
    assert(activity && activity.ownerId === currentUserId, 'FORBIDDEN', '你没有权限取消该活动');
    if (activity.status !== 'CANCELLED') {
      assert(['RECRUITING', 'FORMED'].includes(activity.status), 'CONFLICT', '当前状态不能取消活动');
      activity.status = 'CANCELLED';
      if (activity.type === 'ride') activity.rideJoinable = false;
      activity.cancelReason = input.reason;
      activity.updatedAt = new Date().toISOString();
    }
    state.applications.forEach((item) => {
      if (item.activityId === activity.id && item.status === 'PENDING') {
        item.status = 'CANCELLED_BY_ACTIVITY';
        item.updatedAt = activity.updatedAt;
      }
    });
    return { activity: publicActivity(activity) };
  }
  if (action === 'activity.complete') {
    const activity = activityById(input.activityId);
    assert(activity && activity.ownerId === currentUserId, 'FORBIDDEN', '你没有权限完成该活动');
    assert(['FORMED', 'IN_PROGRESS'].includes(activity.status), 'CONFLICT', '当前状态不能完成活动');
    activity.status = 'COMPLETED';
    activity.completedAt = new Date().toISOString();
    if (activity.type === 'ride') activity.rideJoinable = false;
    return { activity: publicActivity(activity) };
  }
  if (action === 'group.contact') {
    const activity = activityById(input.activityId);
    assert(activity && ['FORMED', 'IN_PROGRESS', 'COMPLETED'].includes(activity.status), 'CONFLICT', '活动成团后才能查看联系信息');
    assert(activeMember(activity.id, currentUserId), 'FORBIDDEN', '仅活动成员可以查看联系信息');
    return { activityId: activity.id, contactInfo: activity.contactInfo, meeting: { city: activity.city, district: activity.district, placeLabel: activity.placeLabel, note: activity.rules } };
  }
  if (action === 'notification.list') {
    return {
      items: state.notifications
        .filter((item) => item.userId === currentUserId)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .map(publicNotification)
    };
  }
  if (action === 'notification.read') {
    const item = state.notifications.find((notification) => notification.id === input.notificationId);
    assert(item && item.userId === currentUserId, 'FORBIDDEN', '你没有权限处理该通知');
    item.read = true;
    return { notification: publicNotification(item) };
  }
  if (action === 'report.create') {
    const duplicate = state.reports.find((item) => item.reporterId === currentUserId && item.targetType === input.targetType && item.targetId === input.targetId);
    assert(!duplicate, 'CONFLICT', '你已经举报过该内容');
    const report = { id: nextId('report'), reporterId: currentUserId, ...clone(input), status: 'NEW', createdAt: new Date().toISOString() };
    state.reports.push(report);
    const { reporterId, ...safeReport } = report;
    return { report: clone(safeReport), hiddenForReporter: true };
  }
  if (action === 'admin.activity.suspend') {
    const admin = requireUser();
    assert(admin.role === 'admin', 'FORBIDDEN', '你没有权限执行此操作');
    const activity = activityById(input.activityId);
    assert(activity, 'NOT_FOUND', '活动不存在或已失效');
    if (activity.status !== 'SUSPENDED') {
      activity.status = 'SUSPENDED';
      if (activity.type === 'ride') activity.rideJoinable = false;
      activity.suspension = {
        adminId: admin.id,
        reason: input.reason || '',
        at: new Date().toISOString()
      };
      activity.version += 1;
      activity.updatedAt = activity.suspension.at;
    }
    return { activity: publicActivity(activity) };
  }
  throw fail('NOT_FOUND', '接口动作不存在');
}

async function call(event) {
  try {
    const action = event.action;
    const isMutation = MUTATING_ACTIONS.has(action);
    const idempotencyId = isMutation && event.idempotencyKey
      ? `${currentUserId}:${action}:${event.idempotencyKey}`
      : '';
    if (isMutation) assert(idempotencyId, 'VALIDATION_ERROR', '写操作缺少幂等键');
    if (isMutation) requireUser();
    if (idempotencyId && !BUSINESS_IDEMPOTENT_ACTIONS.has(action) && state.idempotency[idempotencyId]) {
      const replay = ok(clone(state.idempotency[idempotencyId]));
      replay.idempotentReplay = true;
      return replay;
    }
    const data = handle(action, event.data || {}, event.idempotencyKey || '');
    if (idempotencyId && !BUSINESS_IDEMPOTENT_ACTIONS.has(action)) state.idempotency[idempotencyId] = clone(data);
    return ok(data);
  } catch (error) {
    if (error && error.ok === false) return error;
    return fail('INTERNAL', '演示服务暂时不可用，请重试');
  }
}

function setPersona(userId) {
  if (!userById(userId)) return false;
  currentUserId = userId;
  persist();
  return true;
}

function getPersona() {
  return currentUserId;
}

function reset() {
  state = seedState();
  currentUserId = 'u_owner';
  persist();
}

module.exports = {
  call,
  setPersona,
  getPersona,
  reset
};
