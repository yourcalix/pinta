'use strict';

const {
  PILOT_CITY,
  PILOT_DISTRICTS,
  RIDE_ROUTES,
  getRideRoute
} = require('../config/locations');

const ACTIVITY_TYPES = Object.freeze(['companion', 'sport', 'food']);
const LEGACY_ACTIVITY_TYPE_MAP = Object.freeze({ ride: 'companion', buddy: 'sport', product: 'food' });
const REMOVED_ACTIONS = new Set([
  'student.verification.get', 'student.verification.submit', 'student.document.prepare',
  'student.document.confirm', 'admin.studentVerification.review',
  'onboarding.selectRole',
  'driver.application.get', 'driver.application.submit', 'driver.document.prepare',
  'driver.document.confirm', 'driver.application.withdraw', 'admin.driverApplication.review',
  'ride.join', 'ride.driver.profile', 'ride.driver.mine', 'ride.driver.memberContacts',
  'ride.driver.accept', 'ride.driver.cancel'
]);

const STATE_KEY = 'pinba_mock_state_v3';
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
  'community.post.create',
  'community.reply.create',
  'community.post.delete',
  'community.reply.delete',
  'community.like.set',
  'application.submit',
  'application.approve',
  'application.reject',
  'application.withdraw',
  'ride.join',
  'member.leave',
  'group.contact.share',
  'group.contact.revoke',
  'group.message.send',
  'group.message.read',
  'dm.conversation.create',
  'dm.consult.create',
  'dm.message.send',
  'dm.conversation.read',
  'notification.read',
  'report.create',
  'admin.activity.suspend',
  'ride.driver.accept',
  'ride.driver.cancel'
]);
const BUSINESS_IDEMPOTENT_ACTIONS = new Set([
  'driver.application.submit', 'admin.driverApplication.review', 'community.like.set',
  'group.message.send', 'group.message.read', 'dm.consult.create', 'dm.message.send'
]);
const PUBLIC_ACTIONS = new Set([
  'activity.list',
  'activity.detail',
  'activity.question.list',
  'community.post.list',
  'community.post.detail'
]);
const MAX_PUBLIC_SCAN = 500;
const mockSensitiveHashSalt = `${Date.now()}:${Math.random()}:${Math.random()}`;
const PASSENGER_AVATAR_KINDS = Object.freeze(['PASSENGER_A', 'PASSENGER_B']);

function avatarKindFromGender(gender) {
  if (gender === 'MALE') return 'PASSENGER_A';
  if (gender === 'FEMALE') return 'PASSENGER_B';
  return null;
}

function completeRideProfile(profile) {
  return Boolean(profile && profile.adultConfirmed === true && ['MALE', 'FEMALE'].includes(profile.gender));
}

function normalizeAvatarRoster(roster) {
  if (!Array.isArray(roster)) return [];
  const seen = new Set();
  return roster.filter((item) => {
    if (!item || typeof item.memberId !== 'string' || !PASSENGER_AVATAR_KINDS.includes(item.avatarKind) || seen.has(item.memberId)) return false;
    seen.add(item.memberId);
    return true;
  }).slice(0, 20).map((item) => ({ memberId: item.memberId, avatarKind: item.avatarKind }));
}

function upsertAvatarRoster(roster, memberId, avatarKind) {
  const next = normalizeAvatarRoster(roster);
  if (!PASSENGER_AVATAR_KINDS.includes(avatarKind)) return next;
  const existing = next.find((item) => item.memberId === memberId);
  if (existing) existing.avatarKind = avatarKind;
  else if (next.length < 20) next.push({ memberId, avatarKind });
  return next;
}

function publicAvatarSlots(roster, capacity = 7) {
  const total = Math.max(1, Math.min(20, Math.floor(Number(capacity)) || 7));
  const kinds = normalizeAvatarRoster(roster).map((item) => item.avatarKind);
  while (kinds.length < total) kinds.push('EMPTY');
  return kinds.slice(0, total).map((kind) => ({ kind }));
}

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

function stableMockEntityId(prefix, ...parts) {
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  const input = parts.map((part) => String(part)).join('\u001f');
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    hashA = Math.imul(hashA ^ code, 0x01000193) >>> 0;
    hashB = Math.imul(hashB ^ code, 0x85ebca6b) >>> 0;
  }
  return `${prefix}_${hashA.toString(16).padStart(8, '0')}${hashB.toString(16).padStart(8, '0')}`;
}

function normalizeActivityForRead(activity, now) {
  if (!activity) return activity;
  if (activity.type === 'ride') {
    activity = {
      ...activity,
      targetMembers: 7,
      minMembers: 7,
      maxMembers: 7,
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

function validRidePhone(value) {
  return /^(?:\+8536\d{7}|\+861\d{10}|\+852[569]\d{7})$/.test(String(value || '').replace(/[\s()-]+/g, ''));
}

function directMessagePreviewSeed(referenceTime = new Date().toISOString()) {
  const baseTime = Number.isFinite(Date.parse(referenceTime)) ? Date.parse(referenceTime) : Date.now();
  const at = (minutesAgo) => new Date(baseTime - minutesAgo * 60 * 1000).toISOString();
  const conversationId = 'conversation_demo_buddy_owner_member';
  const messages = [
    { id: 'directMessage_demo_1', conversationId, senderId: 'u_owner', text: '你好，想确认一下明天下午的集合地点。', status: 'SENT', createdAt: at(12), updatedAt: at(12) },
    { id: 'directMessage_demo_2', conversationId, senderId: 'u_member', text: '可以呀，我们在体育馆一楼前台旁见。', status: 'SENT', createdAt: at(10), updatedAt: at(10) },
    { id: 'directMessage_demo_3', conversationId, senderId: 'u_member', text: '我会提前十分钟到，也会带一筒球。', status: 'SENT', createdAt: at(9), updatedAt: at(9) },
    { id: 'directMessage_demo_4', conversationId, senderId: 'u_owner', text: '没问题，我带球拍，明天见。', status: 'SENT', createdAt: at(5), updatedAt: at(5) },
    { id: 'directMessage_demo_5', conversationId, senderId: 'u_member', text: '好的，明天见～', status: 'SENT', createdAt: at(2), updatedAt: at(2) }
  ];
  return {
    conversations: [{
      id: conversationId,
      participantAId: 'u_member',
      participantBId: 'u_owner',
      source: { type: 'activity', id: 'a_buddy', title: '周末新手羽毛球双打' },
      lastMessageId: messages[messages.length - 1].id,
      lastMessagePreview: messages[messages.length - 1].text,
      lastMessageAt: messages[messages.length - 1].createdAt,
      lastSenderId: messages[messages.length - 1].senderId,
      unreadByUser: { u_owner: 1, u_member: 0 },
      createdAt: messages[0].createdAt,
      updatedAt: messages[messages.length - 1].createdAt
    }],
    messages
  };
}

function seedState() {
  const now = new Date().toISOString();
  const directPreview = directMessagePreviewSeed(now);
  const rideStartDate = new Date(Date.now() + 26 * 60 * 60 * 1000);
  rideStartDate.setMinutes(Math.ceil(rideStartDate.getMinutes() / 15) * 15, 0, 0);
  const rideStartsAt = rideStartDate.toISOString();
  const rideWindowEnd = new Date(rideStartDate.getTime() + 60 * 60 * 1000).toISOString();
  return {
    schemaVersion: 9,
    sequence: 100,
    users: [
      { id: 'u_owner', role: 'user', status: 'ACTIVE', profile: { nickname: '小拼', gender: 'MALE', city: '澳门', interests: ['结伴同行'], adultConfirmed: true } },
      { id: 'u_member', role: 'user', status: 'ACTIVE', profile: { nickname: '阿同', gender: 'FEMALE', city: '澳门', interests: ['结伴同行'], adultConfirmed: true } },
      { id: 'u_driver', role: 'user', status: 'ACTIVE', onboarding: { roleIntent: 'DRIVER', completedAt: now }, profile: { nickname: '林师傅', gender: 'MALE', city: '澳门', interests: ['邻里互助'], adultConfirmed: true } },
      { id: 'u_student', role: 'user', status: 'ACTIVE', profile: { nickname: '小满', gender: 'FEMALE', city: '澳门', interests: ['城市活动'], adultConfirmed: true } },
      { id: 'u_merchant', role: 'user', status: 'ACTIVE', profile: { nickname: '邻里团长', gender: 'FEMALE', city: '澳门', interests: ['凑单'], adultConfirmed: true } },
      { id: 'u_admin', role: 'admin', status: 'ACTIVE', profile: { nickname: '运营', gender: 'MALE', city: '澳门', interests: [], adultConfirmed: true } },
      { id: 'u_disabled', role: 'user', status: 'DISABLED', profile: { nickname: '受限账号', gender: 'MALE', city: '澳门', interests: [], adultConfirmed: true } }
    ],
    activities: [
      {
        id: 'a_ride', ownerId: 'u_owner', owner: { nickname: '小拼' }, type: 'companion',
        title: '周五晚一起去凼仔', description: '寻找同路伙伴，成团后共同商量合规出行方式。',
        city: '澳门', district: '澳门城区', placeLabel: '青茂口岸 → 凼仔',
        startsAt: rideStartsAt, deadlineAt: isoAfter(18), targetMembers: 4, minMembers: 2, maxMembers: 4, memberCount: 1,
        rules: '成团后在公共区域集合，自主选择合法出行方式。',
        typeData: {
          originLabel: '青茂口岸', destinationLabel: '凼仔',
          timeFlexibility: 'WITHIN_60_MIN', transportPreference: 'DISCUSS_AFTER_FORMED', luggageType: 'NONE'
        },
        status: 'RECRUITING', avatarRoster: [{ memberId: 'm_ride_owner', avatarKind: 'PASSENGER_A' }], version: 1, createdAt: now, updatedAt: now
      },
      {
        id: 'a_product', ownerId: 'u_merchant', owner: { nickname: '邻里团长' }, type: 'food',
        title: '今晚一起吃火锅', description: '想找几位伙伴一起拼桌，口味和时间成团后商量。',
        city: '澳门', district: '澳门城区', placeLabel: '附近餐厅',
        startsAt: isoAfter(40), deadlineAt: isoAfter(28), targetMembers: 4, minMembers: 2, maxMembers: 4, memberCount: 1,
        rules: '各自到店消费，不代收款、不提供配送。',
        typeData: { venue: '附近餐厅', cuisine: '火锅', budget: '人均约 80', dietaryNotes: '可选清汤锅' },
        status: 'RECRUITING', version: 1, createdAt: now, updatedAt: now
      },
      {
        id: 'a_buddy', ownerId: 'u_owner', owner: { nickname: '小拼' }, type: 'sport',
        title: '周末新手羽毛球双打', description: '新手友好，轻松运动一小时，场地费AA。',
        city: '澳门', district: '澳门城区', placeLabel: '附近体育馆',
        startsAt: isoAfter(10), deadlineAt: isoAfter(5), targetMembers: 4, minMembers: 2, maxMembers: 4, memberCount: 2,
        rules: '体育馆一楼前台旁会合，请自带球拍。',
        typeData: { sportType: '羽毛球', venue: '附近体育馆', level: 'BEGINNER', intensity: 'RELAXED', equipment: '自带球拍' },
        status: 'FORMED', version: 2, formedAt: now, createdAt: now, updatedAt: now
      },
      {
        id: 'a_suspended', ownerId: 'u_owner', owner: { nickname: '小拼' }, type: 'buddy',
        title: '已下架活动测试数据', description: '仅用于验证下架状态，不应出现在公开列表或详情中。',
        city: '澳门', district: '澳门城区', placeLabel: '测试地点',
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
      { id: 'm_ride_owner', activityId: 'a_ride', userId: 'u_owner', role: 'OWNER', status: 'ACTIVE', joinedAt: now, luggageType: 'NONE', avatarKind: 'PASSENGER_A' },
      { id: 'm_product_owner', activityId: 'a_product', userId: 'u_merchant', role: 'OWNER', status: 'ACTIVE', joinedAt: now },
      { id: 'm_buddy_owner', activityId: 'a_buddy', userId: 'u_owner', role: 'OWNER', status: 'ACTIVE', joinedAt: now },
      { id: 'm_buddy_member', activityId: 'a_buddy', userId: 'u_member', role: 'MEMBER', status: 'ACTIVE', joinedAt: now }
    ],
    memberContacts: [
      { id: 'mc_ride_owner', activityId: 'a_ride', memberId: 'm_ride_owner', userId: 'u_owner', phone: '+85361234567', status: 'ACTIVE', createdAt: now, updatedAt: now }
    ],
    notifications: [
      {
        id: 'n_owner_apply', userId: 'u_owner', type: 'NEW_APPLICATION', activityId: 'a_ride',
        title: '“青茂口岸到凼仔同行”有新的加入申请', read: false, createdAt: now,
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
    communityPosts: [
      {
        id: 'community_welcome', authorId: 'u_member',
        author: { nickname: '阿同', avatarKind: 'PASSENGER_B' },
        content: '大家从横琴口岸去凼仔时，通常会提前多久出发？想听听大家的经验。',
        replyCount: 1, status: 'ACTIVE', createdAt: now, updatedAt: now
      }
    ],
    communityReplies: [
      {
        id: 'community_reply_welcome', postId: 'community_welcome', authorId: 'u_owner',
        author: { nickname: '小拼', avatarKind: 'PASSENGER_A' }, content: '晚高峰建议多预留半小时。',
        status: 'ACTIVE', createdAt: now, updatedAt: now
      }
    ],
    communityLikes: [],
    directConversations: directPreview.conversations,
    directMessages: directPreview.messages,
    groupMessages: [],
    groupReadStates: [],
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
if (!state || state.schemaVersion !== 9) state = seedState();
let currentUserId = readStorage(PERSONA_KEY) || 'u_owner';
if (!state.idempotency) state.idempotency = {};
if (!state.activityQuestions) state.activityQuestions = [];
if (!state.drivers) state.drivers = [];
if (!state.vehicles) state.vehicles = [];
if (!state.rideFulfillments) state.rideFulfillments = [];
if (!state.driverApplications) state.driverApplications = [];
if (!state.driverDocumentUploads) state.driverDocumentUploads = [];
if (!state.memberContacts) state.memberContacts = [];
if (!state.communityPosts) state.communityPosts = [];
if (!state.communityReplies) state.communityReplies = [];
if (!state.communityLikes) state.communityLikes = [];
if (!state.groupMessages) state.groupMessages = [];
if (!state.groupReadStates) state.groupReadStates = [];
if (!Array.isArray(state.directConversations)
  || !Array.isArray(state.directMessages)
  || (!state.directConversations.length && !state.directMessages.length)) {
  const directPreview = directMessagePreviewSeed();
  state.directConversations = directPreview.conversations;
  state.directMessages = directPreview.messages;
}
function initializeActivityCommunication(target) {
  target.activities.forEach((activity) => {
  if (!Number.isSafeInteger(activity.groupSequence) || activity.groupSequence < 0) activity.groupSequence = 0;
  });
  target.members.forEach((member) => {
  if (!member.groupWindow && member.status === 'ACTIVE') {
    const activity = target.activities.find((item) => item.id === member.activityId);
    member.groupWindow = { generation: 1, after: activity && activity.groupSequence || 0 };
  }
  });
  return target;
}
initializeActivityCommunication(state);

function publicCommunityPost(item) {
  const like = state.communityLikes.find((entry) => entry.targetType === 'post' && entry.targetId === item.id && entry.actorId === currentUserId && entry.status === 'ACTIVE');
  return {
    id: item.id,
    author: clone(item.author),
    content: item.content,
    replyCount: Number(item.replyCount || 0),
    likeCount: Number(item.likeCount || 0),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    viewerIsAuthor: item.authorId === currentUserId,
    viewerHasLiked: Boolean(like)
  };
}

function publicCommunityReply(item) {
  const like = state.communityLikes.find((entry) => entry.targetType === 'reply' && entry.targetId === item.id && entry.actorId === currentUserId && entry.status === 'ACTIVE');
  return {
    id: item.id,
    postId: item.postId,
    author: clone(item.author),
    content: item.content,
    likeCount: Number(item.likeCount || 0),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    viewerIsAuthor: item.authorId === currentUserId,
    viewerHasLiked: Boolean(like)
  };
}

function assertCommunityContent(content, max) {
  const normalized = String(content || '').trim();
  const compact = normalized.replace(/[\s._\-—:：·（）()]+/g, '');
  assert(normalized.length >= 1 && normalized.length <= max, 'VALIDATION_ERROR', `内容长度不能超过${max}个字符`);
  const forbidden = /(?:https?:\/\/|www\.|(?:weixin|wechat|微信|vx|v信|微讯|qq|群号)[A-Za-z0-9]{4,}|(?:\+?\d[\d\s()-]{6,}\d)|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i;
  assert(!forbidden.test(normalized) && !forbidden.test(compact), 'VALIDATION_ERROR', '讨论区不支持外链或联系方式');
  return normalized;
}

function assertDirectMessageContent(content) {
  const normalized = String(content || '').trim();
  assert(normalized.length >= 1 && normalized.length <= 500, 'VALIDATION_ERROR', '消息内容长度不符合要求');
  const compact = normalized.replace(/[\s._\-—:：·（）()]+/g, '');
  const forbidden = /(?:https?:\/\/|www\.|(?:weixin|wechat|微信|vx|v信|微讯|qq|群号)[A-Za-z0-9]{4,}|(?:\+?\d[\d\s()-]{6,}\d)|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i;
  assert(!forbidden.test(normalized) && !forbidden.test(compact), 'VALIDATION_ERROR', '私信暂不支持外链或联系方式');
  return normalized;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function asciiBase64Encode(value) {
  let result = '';
  for (let index = 0; index < value.length; index += 3) {
    const first = value.charCodeAt(index);
    const second = index + 1 < value.length ? value.charCodeAt(index + 1) : NaN;
    const third = index + 2 < value.length ? value.charCodeAt(index + 2) : NaN;
    result += BASE64_ALPHABET[first >> 2];
    result += BASE64_ALPHABET[((first & 3) << 4) | (Number.isNaN(second) ? 0 : second >> 4)];
    result += Number.isNaN(second) ? '=' : BASE64_ALPHABET[((second & 15) << 2) | (Number.isNaN(third) ? 0 : third >> 6)];
    result += Number.isNaN(third) ? '=' : BASE64_ALPHABET[third & 63];
  }
  return result.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function asciiBase64Decode(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  let result = '';
  for (let index = 0; index < padded.length; index += 4) {
    const a = BASE64_ALPHABET.indexOf(padded[index]);
    const b = BASE64_ALPHABET.indexOf(padded[index + 1]);
    const c = padded[index + 2] === '=' ? -1 : BASE64_ALPHABET.indexOf(padded[index + 2]);
    const d = padded[index + 3] === '=' ? -1 : BASE64_ALPHABET.indexOf(padded[index + 3]);
    if (a < 0 || b < 0 || c < -1 || d < -1) throw new Error('invalid base64');
    result += String.fromCharCode((a << 2) | (b >> 4));
    if (c >= 0) result += String.fromCharCode(((b & 15) << 4) | (c >> 2));
    if (d >= 0) result += String.fromCharCode(((c & 3) << 6) | d);
  }
  return result;
}

function encodeCommunityCursor(item) {
  return asciiBase64Encode(JSON.stringify({ createdAt: item.createdAt, id: item.id }));
}

function encodeDirectCursor(item, timeField) {
  return asciiBase64Encode(JSON.stringify({ createdAt: item[timeField], id: item.id }));
}

function decodeDirectCursor(value) {
  return decodeCommunityCursor(value);
}

function afterDirectCursor(item, cursor, timeField) {
  return !cursor || item[timeField] < cursor.createdAt || (item[timeField] === cursor.createdAt && item.id < cursor.id);
}

function decodeCommunityCursor(value) {
  if (value === undefined || value === null || value === '') return null;
  try {
    const parsed = JSON.parse(asciiBase64Decode(value));
    assert(parsed && Number.isFinite(Date.parse(parsed.createdAt)) && typeof parsed.id === 'string' && parsed.id, 'VALIDATION_ERROR', '分页游标无效');
    return parsed;
  } catch (error) {
    if (error && error.ok === false) throw error;
    throw fail('VALIDATION_ERROR', '分页游标无效');
  }
}

function afterDescendingCommunityCursor(item, cursor) {
  return !cursor || item.createdAt < cursor.createdAt || (item.createdAt === cursor.createdAt && item.id < cursor.id);
}

function afterAscendingCommunityCursor(item, cursor) {
  return !cursor || item.createdAt > cursor.createdAt || (item.createdAt === cursor.createdAt && item.id > cursor.id);
}

function persist() {
  const { memberContacts, directMessages, directConversations, groupMessages, groupReadStates, ...safeState } = state;
  writeStorage(STATE_KEY, safeState);
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

function directConversationDto(conversation) {
  const peerId = conversation.participantAId === currentUserId ? conversation.participantBId : conversation.participantAId;
  const peer = userById(peerId);
  const sourceActivity = conversation.source && activityById(conversation.source.id);
  const sourceActivityType = sourceActivity
    ? LEGACY_ACTIVITY_TYPE_MAP[sourceActivity.type] || sourceActivity.type
    : null;
  return {
    id: conversation.id,
    kind: conversation.kind === 'OWNER_CONSULT' ? 'OWNER_CONSULT' : 'MEMBER_DM',
    peer: {
      nickname: peer && peer.profile && peer.profile.nickname || '拼吧用户',
      avatarKind: avatarKindFromGender(peer && peer.profile && peer.profile.gender)
    },
    source: conversation.source ? {
      ...clone(conversation.source),
      activityType: ACTIVITY_TYPES.includes(sourceActivityType) ? sourceActivityType : null
    } : null,
    lastMessage: conversation.lastMessageId ? {
      id: conversation.lastMessageId,
      preview: conversation.lastMessagePreview || '',
      isMine: conversation.lastSenderId === currentUserId,
      createdAt: conversation.lastMessageAt
    } : null,
    unreadCount: Math.max(0, Number(conversation.unreadByUser && conversation.unreadByUser[currentUserId]) || 0),
    messagingAvailable: Boolean(sourceActivity
      && (conversation.kind === 'OWNER_CONSULT'
        ? ['RECRUITING', 'FORMED', 'IN_PROGRESS'].includes(sourceActivity.status)
          && sourceActivity.ownerId === conversation.ownerId
        : ['FORMED', 'IN_PROGRESS'].includes(sourceActivity.status)
          && [conversation.participantAId, conversation.participantBId].every((id) => activeMember(sourceActivity.id, id)))
      && [conversation.participantAId, conversation.participantBId].every((id) => userById(id) && userById(id).status === 'ACTIVE')),
    updatedAt: conversation.updatedAt
  };
}

function directMessageDto(message) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    text: message.text,
    isMine: message.senderId === currentUserId,
    status: message.status || 'SENT',
    createdAt: message.createdAt
  };
}

function groupAccess(activityId, write = false) {
  const user = requireActiveUser(true);
  assert(completeRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先完善个人资料');
  const activity = activityById(activityId);
  assert(activity, 'NOT_FOUND', '活动不存在或已失效');
  assert(activity.status !== 'SUSPENDED', 'TAKEDOWN', '活动已下架');
  assert(['RECRUITING', 'FORMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED'].includes(activity.status), 'FORBIDDEN', '当前无法访问群聊');
  const member = activeMember(activity.id, user.id);
  assert(member && member.groupWindow && Number.isSafeInteger(member.groupWindow.generation)
    && member.groupWindow.generation > 0 && Number.isSafeInteger(member.groupWindow.after)
    && Number.isSafeInteger(activity.groupSequence) && member.groupWindow.after <= activity.groupSequence,
  'FORBIDDEN', '你不是该活动当前的有效成员');
  const writable = ['RECRUITING', 'FORMED', 'IN_PROGRESS'].includes(activity.status);
  assert(!write || writable, 'CONFLICT', '活动已结束，群聊仅可查看');
  return { user, activity, member, generation: member.groupWindow.generation,
    after: member.groupWindow.after, latestSequence: activity.groupSequence, writable };
}

function publicGroupMessage(message) {
  const sender = userById(message.senderId);
  return {
    id: message.id,
    sequence: message.sequence,
    text: message.text,
    isMine: message.senderId === currentUserId,
    sender: { nickname: sender && sender.profile && sender.profile.nickname || '拼吧用户',
      avatarKind: avatarKindFromGender(sender && sender.profile && sender.profile.gender),
      role: message.memberId && state.members.find((item) => item.id === message.memberId)?.role === 'OWNER' ? 'OWNER' : 'MEMBER' },
    createdAt: message.createdAt
  };
}

function isMockRideJoinable(activity, at) {
  if (!activity || activity.type !== 'ride') return false;
  if (!['RECRUITING', 'FORMED'].includes(activity.status)) return false;
  if (activity.memberCount >= 7) return false;
  if (Date.parse(activity.deadlineAt) <= Date.parse(at)) return false;
  return true;
}

function mockRideJoinUnavailableReason(activity, at) {
  if (activity.status === 'CANCELLED') return '行程已取消';
  if (activity.status === 'EXPIRED') return '行程已过期';
  if (!['RECRUITING', 'FORMED'].includes(activity.status)) return '当前行程暂不可加入';
  if (Number(activity.memberCount || 0) >= 7) return '行程已满员';
  const now = Date.parse(at);
  const deadline = Date.parse(activity.deadlineAt);
  if (!Number.isFinite(now) || !Number.isFinite(deadline)) return '加入资格暂不可用，请稍后重试';
  if (deadline <= now) return '报名已截止';
  return '';
}

function isMockRideAcceptable(activity, at) {
  if (!activity || activity.type !== 'ride' || !['RECRUITING', 'FORMED'].includes(activity.status)) return false;
  const fulfillment = (state.rideFulfillments || []).find((item) => item.activityId === activity.id);
  if (!fulfillment || fulfillment.status !== 'UNASSIGNED') return false;
  return Date.parse(activity.typeData && activity.typeData.pickupWindowEnd) > Date.parse(at);
}

// Authenticated self-profile DTO. Public activity responses never use this helper.
function selfUser(user) {
  return user ? {
    role: user.role,
    status: user.status,
    onboarding: user.onboarding ? clone(user.onboarding) : { roleIntent: null, completedAt: null },
    profile: clone(user.profile),
    profileComplete: completeRideProfile(user.profile)
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
  // Normalize legacy capacity even for callers that bypass the public list/detail readers.
  activity = normalizeActivityForRead(activity);
  const anonymous = options && options.anonymous === true;
  const viewerApplication = anonymous
    ? null
    : state.applications
      .filter((item) => item.activityId === activity.id && item.applicantId === currentUserId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const viewerMember = anonymous ? null : activeMember(activity.id, currentUserId);
  const storedType = activity.type;
  const viewerRole = anonymous
    ? 'guest'
    : activity.ownerId === currentUserId
      ? 'owner'
      : viewerMember
        ? 'member'
        : viewerApplication ? 'applicant' : 'guest';
  const { contactInfo, ownerId, version, suspension, operationKeyHash, avatarRoster, ...safe } = activity;
  const capacity = activity.maxMembers || activity.maxPassengers || activity.targetMembers;
  const result = {
    ...clone(safe),
    type: LEGACY_ACTIVITY_TYPE_MAP[storedType] || storedType,
    minMembers: activity.minMembers || activity.minPassengers || Math.min(2, capacity),
    maxMembers: capacity,
    avatarSlots: publicAvatarSlots(avatarRoster, capacity),
    remainingCapacity: Math.max(0, Number(capacity) - Number(activity.memberCount || 0)),
    status: activity.status,
    viewerRole
  };
  if (LEGACY_ACTIVITY_TYPE_MAP[storedType]) result.legacy = { sourceType: storedType, readOnly: true };
  if (viewerApplication) result.viewerApplication = publicApplication(viewerApplication);
  if (viewerMember) {
    result.viewerMembership = {
      role: viewerMember.role,
      status: viewerMember.status,
      joinedAt: viewerMember.joinedAt,
      ...(storedType === 'ride' ? { luggageType: viewerMember.luggageType || null } : {})
    };
  }
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

function requireActiveUser(requireProfile = false) {
  const user = requireUser();
  if (requireProfile) {
    assert(user.profile && user.profile.adultConfirmed === true, 'PROFILE_INCOMPLETE', '请先完成成年确认和基本资料');
  }
  return user;
}

function requireApprovedDriver(requireProfile = false) {
  const user = requireUser();
  if (requireProfile) {
    assert(user.profile && user.profile.adultConfirmed === true, 'PROFILE_INCOMPLETE', '请先完成成年确认和基本资料');
  }
  const profile = driverProfile();
  assert(profile && profile.canAcceptRide === true, 'DRIVER_NOT_APPROVED', '司机资格尚未通过审核');
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
  assert(!type || ACTIVITY_TYPES.includes(type), 'VALIDATION_ERROR', '活动类型选项无效', { field: '活动类型' });
  assert(city === PILOT_CITY, 'VALIDATION_ERROR', '当前仅支持试点区域', { field: 'city' });
  assert(!district || PILOT_DISTRICTS.includes(district), 'VALIDATION_ERROR', '行政区选项无效', { field: '行政区' });
  return {
    type: type || undefined,
    city,
    district: district || undefined,
    keyword: keyword || undefined
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
  if (filters.type) candidates = candidates.filter((item) => (LEGACY_ACTIVITY_TYPE_MAP[item.type] || item.type) === filters.type);
  candidates = candidates.filter((item) => item.city === filters.city);
  if (filters.district) candidates = candidates.filter((item) => item.district === filters.district);
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
    if (['RECRUITING', 'FORMED'].includes(activity.status) && keywordMatch) {
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
  const activityInput = clone(input);
  assert(ACTIVITY_TYPES.includes(activityInput.type), 'VALIDATION_ERROR', '活动类型选项无效');
  assert(normalizedContent(activityInput.title, '标题', 2, 40), 'VALIDATION_ERROR', '标题格式无效');
  assert(normalizedContent(activityInput.description, '活动说明', 2, 500), 'VALIDATION_ERROR', '活动说明格式无效');
  const startsAt = Date.parse(activityInput.startsAt);
  const deadlineAt = Date.parse(activityInput.deadlineAt);
  assert(Number.isFinite(startsAt) && startsAt > Date.parse(now), 'VALIDATION_ERROR', '活动时间必须晚于当前时间');
  assert(Number.isFinite(deadlineAt) && deadlineAt > Date.parse(now) && deadlineAt < startsAt, 'VALIDATION_ERROR', '报名截止时间无效');
  const minMembers = Number(activityInput.minMembers);
  const maxMembers = Number(activityInput.maxMembers);
  assert(Number.isInteger(minMembers) && Number.isInteger(maxMembers) && minMembers >= 2 && maxMembers <= 20 && minMembers <= maxMembers, 'VALIDATION_ERROR', '人数设置无效');
  assert(activityInput.typeData && typeof activityInput.typeData === 'object', 'VALIDATION_ERROR', '请补齐活动信息');
  delete activityInput.driverId;
  delete activityInput.vehicleId;
  delete activityInput.contactInfo;
  const activity = {
    id: nextId('activity'), ownerId: user.id, owner: { nickname: user.profile.nickname },
    ...activityInput, memberCount: 1, groupSequence: 0, status: 'RECRUITING', version: 1, createdAt: now, updatedAt: now
  };
  state.activities.unshift(activity);
  const ownerMember = {
    id: nextId('member'),
    activityId: activity.id,
    userId: user.id,
    role: 'OWNER',
    status: 'ACTIVE',
    groupWindow: { generation: 1, after: 0 },
    avatarKind: avatarKindFromGender(user.profile.gender),
    joinedAt: now
  };
  activity.avatarRoster = upsertAvatarRoster([], ownerMember.id, ownerMember.avatarKind);
  state.members.push(ownerMember);
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
  const user = requireActiveUser(true);
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
  assert(input && typeof input === 'object', 'VALIDATION_ERROR', '请求参数无效');
  assert(typeof input.activityId === 'string' && input.activityId.trim(), 'VALIDATION_ERROR', '活动ID无效');
  assert(['NONE', 'SMALL', 'LARGE'].includes(input.luggageType), 'VALIDATION_ERROR', '我的行李选项无效');
  assert(validRidePhone(input.phone), 'VALIDATION_ERROR', '请输入正确的联系电话');
  const user = requireUser();
  assert(completeRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先补全性别资料');
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
  member.luggageType = input.luggageType;
  member.avatarKind = avatarKindFromGender(user.profile.gender);
  delete member.leftAt;
  delete member.leaveReason;
  if (!existing) state.members.push(member);
  const existingContact = state.memberContacts.find((item) => item.activityId === activity.id && item.memberId === member.id);
  if (existingContact) Object.assign(existingContact, { phone: input.phone.replace(/[\s()-]+/g, ''), status: 'ACTIVE', updatedAt: now });
  else state.memberContacts.push({
    id: nextId('memberContact'), activityId: activity.id, memberId: member.id, userId: user.id,
    phone: input.phone.replace(/[\s()-]+/g, ''), status: 'ACTIVE', createdAt: now, updatedAt: now
  });
  activity.memberCount += 1;
  activity.avatarRoster = upsertAvatarRoster(activity.avatarRoster, member.id, member.avatarKind);
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
  const capacity = activity.type === 'ride' ? 7 : (activity.maxMembers || activity.targetMembers);
  assert(activity.memberCount < capacity, 'CAPACITY_FULL', '名额已满');
  application.status = 'APPROVED';
  application.approvedAt = now;
  application.updatedAt = now;
  const applicant = state.users.find((item) => item.id === application.applicantId);
  let member = state.members.find((item) => item.activityId === activity.id && item.userId === application.applicantId);
  const previousGeneration = member && member.groupWindow && Number(member.groupWindow.generation) || 0;
  if (!member) member = { id: nextId('member'), activityId: activity.id, userId: application.applicantId, role: 'MEMBER' };
  Object.assign(member, { status: 'ACTIVE', joinedAt: now,
    groupWindow: { generation: previousGeneration + 1, after: Number(activity.groupSequence || 0) },
    avatarKind: avatarKindFromGender(applicant && applicant.profile && applicant.profile.gender) });
  if (!state.members.includes(member)) state.members.push(member);
  activity.avatarRoster = upsertAvatarRoster(activity.avatarRoster, member.id, member.avatarKind);
  activity.memberCount += 1;
  activity.version += 1;
  activity.updatedAt = now;
  const justFormed = activity.status === 'RECRUITING' && activity.memberCount >= (activity.type === 'ride' ? 7 : (activity.minMembers || activity.targetMembers));
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
  if (REMOVED_ACTIONS.has(action)) throw fail('NOT_FOUND', '接口动作不存在');
  if (!PUBLIC_ACTIONS.has(action)) requireUser();
  if (action === 'auth.login') {
    const user = requireUser();
    return {
      user: selfUser(user),
      onboarding: {
        profileComplete: completeRideProfile(user.profile)
      },
      sessionScope: `mock-session-${currentUserId}`
    };
  }
  if (action === 'profile.get') return { user: selfUser(requireUser()) };
  if (action === 'profile.update') {
    const user = requireUser();
    assert(['MALE', 'FEMALE'].includes(input.gender), 'VALIDATION_ERROR', '请选择性别');
    user.profile = clone(input);
    const avatarKind = avatarKindFromGender(input.gender);
    state.members.filter((member) => member.userId === user.id && member.status === 'ACTIVE').forEach((member) => {
      const activity = activityById(member.activityId);
      if (activity && ['RECRUITING', 'FORMED', 'IN_PROGRESS'].includes(activity.status)) {
        member.avatarKind = avatarKind;
        member.updatedAt = new Date().toISOString();
        activity.avatarRoster = upsertAvatarRoster(activity.avatarRoster, member.id, avatarKind);
        activity.updatedAt = member.updatedAt;
      }
    });
    return { user: selfUser(user) };
  }
  if (action === 'onboarding.selectRole') {
    const user = requireUser();
    assert(['PASSENGER', 'DRIVER'].includes(input.roleIntent), 'VALIDATION_ERROR', '注册身份无效');
    user.onboarding = { roleIntent: input.roleIntent, completedAt: new Date().toISOString() };
    return { user: selfUser(user) };
  }
  if (action === 'driver.application.get') {
    requireUser();
    const application = state.driverApplications.find((item) => item.userId === currentUserId);
    return { application: publicDriverApplication(application) };
  }
  if (action === 'driver.document.prepare') {
    const user = requireUser();
    assert(user.profile && user.profile.adultConfirmed === true, 'PROFILE_INCOMPLETE', '请先完成成年确认和基本资料');
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
    const user = requireUser();
    assert(user.profile && user.profile.adultConfirmed === true, 'PROFILE_INCOMPLETE', '请先完成成年确认和基本资料');
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
    const user = requireUser();
    assert(user.profile && user.profile.adultConfirmed === true, 'PROFILE_INCOMPLETE', '请先完成成年确认和基本资料');
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
    requireUser();
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
  if (action === 'community.post.list') {
    const cursor = decodeCommunityCursor(input.cursor);
    const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 30);
    const items = state.communityPosts.filter((item) => item.status === 'ACTIVE')
      .filter((item) => afterDescendingCommunityCursor(item, cursor))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id)));
    const page = items.slice(0, limit + 1);
    return { items: page.slice(0, limit).map(publicCommunityPost), nextCursor: page.length > limit ? encodeCommunityCursor(page[limit - 1]) : null };
  }
  if (action === 'community.post.detail') {
    const post = state.communityPosts.find((item) => item.id === input.postId && item.status === 'ACTIVE');
    assert(post, 'NOT_FOUND', '讨论不存在或已被删除');
    const cursor = decodeCommunityCursor(input.cursor);
    const limit = Math.min(Math.max(Number(input.limit) || 30, 1), 30);
    const replies = state.communityReplies.filter((item) => item.postId === post.id && item.status === 'ACTIVE' && afterAscendingCommunityCursor(item, cursor))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)));
    const page = replies.slice(0, limit + 1);
    return { post: publicCommunityPost(post), replies: page.slice(0, limit).map(publicCommunityReply), nextCursor: page.length > limit ? encodeCommunityCursor(page[limit - 1]) : null };
  }
  if (action === 'community.post.create') {
    const user = requireUser();
    assert(completeRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先完善个人资料');
    const content = assertCommunityContent(input.content, 500);
    const now = new Date().toISOString();
    const post = {
      id: nextId('communityPost'), authorId: user.id,
      author: { nickname: user.profile.nickname, avatarKind: avatarKindFromGender(user.profile.gender) },
      content, replyCount: 0, status: 'ACTIVE', createdAt: now, updatedAt: now
    };
    state.communityPosts.push(post);
    return { post: publicCommunityPost(post) };
  }
  if (action === 'community.reply.create') {
    const user = requireUser();
    assert(completeRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先完善个人资料');
    const post = state.communityPosts.find((item) => item.id === input.postId && item.status === 'ACTIVE');
    assert(post, 'NOT_FOUND', '讨论不存在或已被删除');
    const now = new Date().toISOString();
    const reply = {
      id: nextId('communityReply'), postId: post.id, authorId: user.id,
      author: { nickname: user.profile.nickname, avatarKind: avatarKindFromGender(user.profile.gender) },
      content: assertCommunityContent(input.content, 300), status: 'ACTIVE', createdAt: now, updatedAt: now
    };
    state.communityReplies.push(reply);
    post.replyCount = Number(post.replyCount || 0) + 1;
    return { reply: publicCommunityReply(reply), replyCount: post.replyCount };
  }
  if (action === 'community.post.delete') {
    const post = state.communityPosts.find((item) => item.id === input.postId && item.status !== 'SUSPENDED');
    assert(post, 'NOT_FOUND', '讨论不存在或已被删除');
    assert(post.authorId === currentUserId, 'FORBIDDEN', '只能删除自己发布的讨论');
    post.status = 'DELETED'; post.deletedAt = new Date().toISOString(); post.updatedAt = post.deletedAt;
    return { deleted: true, postId: post.id };
  }
  if (action === 'community.reply.delete') {
    const reply = state.communityReplies.find((item) => item.id === input.replyId && item.status !== 'SUSPENDED');
    assert(reply, 'NOT_FOUND', '回复不存在或已被删除');
    assert(reply.authorId === currentUserId, 'FORBIDDEN', '只能删除自己的回复');
    reply.status = 'DELETED'; reply.deletedAt = new Date().toISOString(); reply.updatedAt = reply.deletedAt;
    const post = state.communityPosts.find((item) => item.id === reply.postId);
    if (post) post.replyCount = Math.max(0, Number(post.replyCount || 0) - 1);
    return { deleted: true, replyId: reply.id, replyCount: Number(post && post.replyCount || 0) };
  }
  if (action === 'community.like.set') {
    const user = requireActiveUser(true);
    assert(completeRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先完善个人资料');
    assert(['post', 'reply'].includes(input.targetType) && typeof input.liked === 'boolean', 'VALIDATION_ERROR', '点赞参数无效');
    const targetId = validatedId(input.targetId, '点赞目标ID');
    const target = input.targetType === 'post'
      ? state.communityPosts.find((item) => item.id === targetId && item.status === 'ACTIVE')
      : state.communityReplies.find((item) => item.id === targetId && item.status === 'ACTIVE');
    assert(target, 'NOT_FOUND', '讨论不存在或已被删除');
    if (input.targetType === 'reply') assert(state.communityPosts.some((item) => item.id === target.postId && item.status === 'ACTIVE'), 'NOT_FOUND', '讨论不存在或已被删除');
    const id = stableMockEntityId('communityLike', input.targetType, targetId, currentUserId);
    let like = state.communityLikes.find((item) => item.targetType === input.targetType && item.targetId === targetId && item.actorId === currentUserId);
    const wasLiked = Boolean(like && like.status === 'ACTIVE');
    if (wasLiked !== input.liked) target.likeCount = Math.max(0, Number(target.likeCount || 0) + (input.liked ? 1 : -1));
    const now = new Date().toISOString();
    if (!like) {
      like = { id, targetType: input.targetType, targetId, postId: input.targetType === 'reply' ? target.postId : target.id, actorId: currentUserId, createdAt: now };
      state.communityLikes.push(like);
    }
    Object.assign(like, { status: input.liked ? 'ACTIVE' : 'DELETED', updatedAt: now });
    return { targetType: input.targetType, targetId, liked: input.liked, likeCount: Number(target.likeCount || 0) };
  }
  if (action === 'activity.mine') {
    const user = requireActiveUser();
    const joinedIds = state.members.filter((item) => item.userId === user.id && item.role === 'MEMBER' && item.status === 'ACTIVE').map((item) => item.activityId);
    return {
      owned: state.activities.filter((item) => item.ownerId === user.id).map(publicActivity),
      joined: state.activities.filter((item) => joinedIds.includes(item.id)).map(publicActivity)
    };
  }
  if (action === 'activity.create') { requireActiveUser(true); return createActivity(input); }
  if (action === 'group.space' || action === 'group.contact.share' || action === 'group.contact.revoke') {
    const user = requireActiveUser();
    const activity = activityById(input.activityId);
    assert(activity && ['FORMED', 'IN_PROGRESS'].includes(activity.status), 'CONFLICT', '仅成团中的活动可使用成员空间');
    const selfMember = state.members.find((item) => item.activityId === activity.id && item.userId === user.id && item.status === 'ACTIVE');
    assert(selfMember, 'FORBIDDEN', '你不是该活动的有效成员');
    if (action === 'group.contact.share') {
      assert(['WECHAT', 'MOBILE'].includes(input.type), 'VALIDATION_ERROR', '联系方式类型无效');
      const value = String(input.value || '').trim();
      assert(input.type === 'WECHAT' ? /^[A-Za-z][-_A-Za-z0-9]{5,19}$/.test(value) : /^\+?\d{8,15}$/.test(value), 'VALIDATION_ERROR', '联系方式格式无效');
      const id = `memberContact:${activity.id}:${selfMember.id}`;
      const existing = state.memberContacts.find((item) => item.id === id);
      const contact = { id, activityId: activity.id, memberId: selfMember.id, userId: user.id, type: input.type, value, shared: true, status: 'ACTIVE', updatedAt: new Date().toISOString() };
      if (existing) Object.assign(existing, contact); else state.memberContacts.push({ ...contact, createdAt: contact.updatedAt });
    }
    if (action === 'group.contact.revoke') {
      const contact = state.memberContacts.find((item) => item.activityId === activity.id && item.memberId === selfMember.id);
      if (contact) Object.assign(contact, { shared: false, status: 'INACTIVE', value: null, updatedAt: new Date().toISOString() });
    }
    const members = state.members.filter((item) => item.activityId === activity.id && item.status === 'ACTIVE').map((item) => {
      const memberUser = userById(item.userId);
      const contact = state.memberContacts.find((entry) => entry.activityId === activity.id && entry.memberId === item.id && entry.status === 'ACTIVE' && entry.shared === true);
      return { memberId: item.id, role: item.role, nickname: memberUser && memberUser.profile.nickname || '拼吧用户', isSelf: item.userId === user.id, sharedContact: contact ? { type: contact.type, value: contact.value } : null };
    });
    return { activityId: activity.id, meeting: { city: activity.city, district: activity.district, placeLabel: activity.placeLabel, note: activity.rules || '' }, members };
  }
  if (action === 'group.thread') {
    const access = groupAccess(validatedId(input.activityId, '活动ID'));
    const read = state.groupReadStates.find((item) => item.activityId === access.activity.id && item.userId === currentUserId
      && item.generation === access.generation);
    const latestIncoming = state.groupMessages.filter((item) => item.activityId === access.activity.id
      && item.senderId !== currentUserId && item.sequence > access.after && item.sequence <= access.latestSequence)
      .sort((left, right) => right.sequence - left.sequence)[0];
    return { activity: { id: access.activity.id, title: access.activity.title, status: access.activity.status },
      generation: access.generation, writable: access.writable,
      hasUnread: Boolean(latestIncoming && latestIncoming.sequence > Number(read && read.sequence || access.after)) };
  }
  if (action === 'group.message.list') {
    const access = groupAccess(validatedId(input.activityId, '活动ID'));
    const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 100);
    const before = input.before === undefined || input.before === null || input.before === '' ? null : Number(input.before);
    assert(before === null || Number.isSafeInteger(before) && before >= 0, 'VALIDATION_ERROR', '分页游标无效');
    const candidates = state.groupMessages.filter((item) => item.activityId === access.activity.id
      && item.sequence > access.after && item.sequence <= access.latestSequence
      && (before === null || item.sequence < before)).sort((left, right) => right.sequence - left.sequence);
    const items = candidates.slice(0, limit);
    return { generation: access.generation, writable: access.writable, items: items.map(publicGroupMessage),
      nextBefore: candidates.length > limit ? items[items.length - 1].sequence : null };
  }
  if (action === 'group.message.send') {
    const access = groupAccess(validatedId(input.activityId, '活动ID'), true);
    const generation = Number(input.generation);
    const clientMessageId = String(input.clientMessageId || '').trim();
    assert(generation === access.generation, 'CONFLICT', '成员状态已变化，请重新进入群聊');
    assert(/^[A-Za-z0-9_-]{1,80}$/.test(clientMessageId), 'VALIDATION_ERROR', '客户端消息ID无效');
    const text = assertDirectMessageContent(input.text);
    const id = stableMockEntityId('groupMessage', access.activity.id, currentUserId, access.member.id, generation, clientMessageId);
    const payloadHash = opaqueSensitiveHash(text);
    const existing = state.groupMessages.find((item) => item.id === id);
    if (existing) {
      assert(existing.payloadHash === payloadHash && existing.sequence > access.after, 'CONFLICT', '客户端消息ID已用于其他内容');
      return { message: publicGroupMessage(existing) };
    }
    assert(access.activity.groupSequence < Number.MAX_SAFE_INTEGER, 'CONFLICT', '群聊序号已失效');
    const now = new Date().toISOString();
    const message = { id, activityId: access.activity.id, sequence: access.activity.groupSequence + 1,
      senderId: currentUserId, memberId: access.member.id, generation, clientMessageId,
      payloadHash, text, status: 'SENT', createdAt: now, updatedAt: now };
    access.activity.groupSequence = message.sequence;
    access.activity.groupLastMessageId = message.id;
    access.activity.updatedAt = now;
    state.groupMessages.push(message);
    return { message: publicGroupMessage(message) };
  }
  if (action === 'group.message.read') {
    const access = groupAccess(validatedId(input.activityId, '活动ID'));
    const generation = Number(input.generation); const sequence = Number(input.sequence);
    assert(generation === access.generation, 'CONFLICT', '成员状态已变化，请重新进入群聊');
    const message = state.groupMessages.find((item) => item.id === input.messageId);
    assert(message && message.activityId === access.activity.id && message.sequence === sequence
      && sequence > access.after && sequence <= access.latestSequence, 'FORBIDDEN', '消息不在当前成员周期内');
    const now = new Date().toISOString();
    let read = state.groupReadStates.find((item) => item.activityId === access.activity.id && item.userId === currentUserId);
    if (!read) { read = { id: stableMockEntityId('groupRead', access.activity.id, currentUserId), activityId: access.activity.id, userId: currentUserId }; state.groupReadStates.push(read); }
    if (read.generation !== generation || sequence > Number(read.sequence || 0)) Object.assign(read, { generation, sequence, updatedAt: now });
    return { generation: read.generation, sequence: read.sequence, readAt: read.updatedAt };
  }
  if (action === 'dm.unread') {
    const user = requireActiveUser(true);
    assert(completeRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先完善个人资料');
    const conversations = state.directConversations.filter((item) => [item.participantAId, item.participantBId].includes(currentUserId))
      .filter((item) => item.kind !== 'OWNER_CONSULT' || activityById(item.source && item.source.id)?.status !== 'SUSPENDED');
    return {
      totalUnread: conversations.reduce((sum, item) => sum + Math.max(0, Number(item.unreadByUser && item.unreadByUser[currentUserId]) || 0), 0),
      conversationsWithUnread: conversations.filter((item) => Number(item.unreadByUser && item.unreadByUser[currentUserId]) > 0).length
    };
  }
  if (action === 'dm.conversation.list') {
    const user = requireActiveUser(true);
    assert(completeRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先完善个人资料');
    const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 30);
    const cursor = decodeDirectCursor(input.cursor);
    const candidates = state.directConversations
      .filter((item) => [item.participantAId, item.participantBId].includes(currentUserId))
      .filter((item) => item.kind !== 'OWNER_CONSULT' || activityById(item.source && item.source.id)?.status !== 'SUSPENDED')
      .filter((item) => afterDirectCursor(item, cursor, 'updatedAt'))
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)) || String(right.id).localeCompare(String(left.id)));
    const page = candidates.slice(0, limit + 1);
    const items = page.slice(0, limit);
    return {
      items: items.map(directConversationDto),
      nextCursor: page.length > limit ? encodeDirectCursor(items[items.length - 1], 'updatedAt') : null
    };
  }
  if (action === 'dm.conversation.create') {
    const user = requireActiveUser(true);
    assert(completeRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先完善个人资料');
    const activity = activityById(input.activityId);
    const actorMember = activeMember(input.activityId, currentUserId);
    const targetMember = state.members.find((item) => item.id === input.memberId);
    assert(
      activity
        && ['FORMED', 'IN_PROGRESS'].includes(activity.status)
        && actorMember
        && targetMember
        && targetMember.activityId === activity.id
        && targetMember.status === 'ACTIVE'
        && targetMember.userId !== currentUserId,
      'NOT_FOUND_OR_NOT_ALLOWED',
      '目标不存在或当前不可联系'
    );
    const peer = userById(targetMember.userId);
    assert(peer && peer.status === 'ACTIVE', 'NOT_FOUND_OR_NOT_ALLOWED', '目标不存在或当前不可联系');
    const participants = [currentUserId, peer.id].sort();
    const conversationId = `conversation_${opaqueSensitiveHash(`${activity.id}:${participants.join(':')}`)}`;
    let conversation = state.directConversations.find((item) => item.id === conversationId);
    if (!conversation) {
      const now = new Date().toISOString();
      conversation = {
        id: conversationId,
        kind: 'MEMBER_DM',
        participantAId: participants[0],
        participantBId: participants[1],
        source: { type: 'activity', id: activity.id, title: activity.title },
        lastMessageId: null,
        lastMessagePreview: '',
        lastMessageAt: null,
        lastSenderId: null,
        unreadByUser: { [participants[0]]: 0, [participants[1]]: 0 },
        createdAt: now,
        updatedAt: now
      };
      state.directConversations.push(conversation);
    }
    return { conversation: directConversationDto(conversation) };
  }
  if (action === 'dm.consult.create') {
    const user = requireActiveUser(true);
    assert(completeRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先完善个人资料');
    const activity = activityById(validatedId(input.activityId, '活动ID'));
    assert(activity && activity.status !== 'SUSPENDED', activity && activity.status === 'SUSPENDED' ? 'TAKEDOWN' : 'NOT_FOUND', '活动不存在或已失效');
    assert(['RECRUITING', 'FORMED', 'IN_PROGRESS'].includes(activity.status) && activity.ownerId !== currentUserId,
      'CONFLICT', activity.ownerId === currentUserId ? '不能与自己发起私信' : '当前活动暂不可咨询');
    const owner = userById(activity.ownerId);
    assert(owner && owner.status === 'ACTIVE', 'NOT_FOUND_OR_NOT_ALLOWED', '发起人当前不可联系');
    const participants = [currentUserId, owner.id].sort();
    const conversationId = stableMockEntityId('consultConversation', activity.id, ...participants);
    let conversation = state.directConversations.find((item) => item.id === conversationId);
    if (!conversation) {
      const now = new Date().toISOString();
      conversation = { id: conversationId, kind: 'OWNER_CONSULT', ownerId: owner.id, consultantId: currentUserId,
        participantAId: participants[0], participantBId: participants[1],
        source: { type: 'activity_consult', id: activity.id, title: activity.title },
        lastMessageId: null, lastMessagePreview: '', lastMessageAt: null, lastSenderId: null,
        unreadByUser: { [participants[0]]: 0, [participants[1]]: 0 }, createdAt: now, updatedAt: now };
      state.directConversations.push(conversation);
    }
    return { conversation: directConversationDto(conversation) };
  }
  if (action === 'dm.message.list') {
    const user = requireActiveUser(true);
    assert(completeRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先完善个人资料');
    const conversation = state.directConversations.find((item) => item.id === input.conversationId);
    assert(conversation && [conversation.participantAId, conversation.participantBId].includes(currentUserId), 'NOT_FOUND_OR_NOT_ALLOWED', '目标不存在或当前不可联系');
    const sourceActivity = conversation.source && activityById(conversation.source.id);
    assert(conversation.kind !== 'OWNER_CONSULT' || sourceActivity && sourceActivity.status !== 'SUSPENDED',
      sourceActivity && sourceActivity.status === 'SUSPENDED' ? 'TAKEDOWN' : 'NOT_FOUND_OR_NOT_ALLOWED', '目标不存在或当前不可联系');
    const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 30);
    const cursor = decodeDirectCursor(input.cursor);
    const candidates = state.directMessages
      .filter((item) => item.conversationId === conversation.id)
      .filter((item) => afterDirectCursor(item, cursor, 'createdAt'))
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)) || String(right.id).localeCompare(String(left.id)));
    const page = candidates.slice(0, limit + 1);
    const items = page.slice(0, limit);
    return {
      conversation: directConversationDto(conversation),
      items: items.map(directMessageDto),
      nextCursor: page.length > limit ? encodeDirectCursor(items[items.length - 1], 'createdAt') : null
    };
  }
  if (action === 'dm.message.send') {
    const user = requireActiveUser(true);
    assert(completeRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先完善个人资料');
    const conversation = state.directConversations.find((item) => item.id === input.conversationId);
    assert(conversation && [conversation.participantAId, conversation.participantBId].includes(currentUserId), 'NOT_FOUND_OR_NOT_ALLOWED', '目标不存在或当前不可联系');
    const clientMessageId = String(input.clientMessageId || '').trim();
    assert(/^[A-Za-z0-9:_-]{8,80}$/.test(clientMessageId), 'VALIDATION_ERROR', '客户端消息ID格式无效');
    const text = assertDirectMessageContent(input.text);
    const id = `directMessage_${opaqueSensitiveHash(`${conversation.id}:${currentUserId}:${clientMessageId}`)}`;
    const existing = state.directMessages.find((item) => item.id === id);
    const payloadHash = opaqueSensitiveHash(text);
    const sourceActivity = conversation.source && activityById(conversation.source.id);
    const participantsActive = [conversation.participantAId, conversation.participantBId]
      .every((id) => userById(id) && userById(id).status === 'ACTIVE');
    if (conversation.kind === 'OWNER_CONSULT') {
      assert(sourceActivity && sourceActivity.status !== 'SUSPENDED', sourceActivity && sourceActivity.status === 'SUSPENDED' ? 'TAKEDOWN' : 'CONFLICT', '活动已结束，这段咨询现为只读');
      assert(['RECRUITING', 'FORMED', 'IN_PROGRESS'].includes(sourceActivity.status)
        && sourceActivity.ownerId === conversation.ownerId && participantsActive, 'CONFLICT', '活动已结束，这段咨询现为只读');
    } else {
      const firstMember = sourceActivity && activeMember(sourceActivity.id, conversation.participantAId);
      const secondMember = sourceActivity && activeMember(sourceActivity.id, conversation.participantBId);
      assert(sourceActivity && ['FORMED', 'IN_PROGRESS'].includes(sourceActivity.status) && firstMember && secondMember
        && participantsActive, 'CONFLICT', '共同活动或成员关系已失效，这段私信现为只读');
    }
    if (existing) {
      assert(existing.conversationId === conversation.id && existing.senderId === currentUserId, 'CONFLICT', '客户端消息ID已用于其他会话');
      assert(existing.payloadHash === payloadHash, 'CONFLICT', '客户端消息ID已用于其他内容');
      return { message: directMessageDto(existing) };
    }
    const now = new Date().toISOString();
    const message = { id, conversationId: conversation.id, senderId: currentUserId, text, payloadHash, status: 'SENT', createdAt: now, updatedAt: now };
    state.directMessages.push(message);
    const recipientId = conversation.participantAId === currentUserId ? conversation.participantBId : conversation.participantAId;
    conversation.lastMessageId = message.id;
    conversation.lastMessagePreview = text.slice(0, 80);
    conversation.lastMessageAt = now;
    conversation.lastSenderId = currentUserId;
    conversation.updatedAt = now;
    conversation.unreadByUser = {
      ...(conversation.unreadByUser || {}),
      [currentUserId]: Number(conversation.unreadByUser && conversation.unreadByUser[currentUserId]) || 0,
      [recipientId]: (Number(conversation.unreadByUser && conversation.unreadByUser[recipientId]) || 0) + 1
    };
    return { message: directMessageDto(message) };
  }
  if (action === 'dm.conversation.read') {
    const user = requireActiveUser(true);
    assert(completeRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先完善个人资料');
    const conversation = state.directConversations.find((item) => item.id === input.conversationId);
    assert(conversation && [conversation.participantAId, conversation.participantBId].includes(currentUserId), 'NOT_FOUND_OR_NOT_ALLOWED', '目标不存在或当前不可联系');
    if (conversation.kind === 'OWNER_CONSULT') {
      const activity = activityById(conversation.source && conversation.source.id);
      assert(activity && activity.status !== 'SUSPENDED',
        activity && activity.status === 'SUSPENDED' ? 'TAKEDOWN' : 'NOT_FOUND_OR_NOT_ALLOWED', '目标不存在或当前不可联系');
    }
    assert(typeof input.lastMessageId === 'string' && input.lastMessageId.length > 0 && input.lastMessageId.length <= 80, 'VALIDATION_ERROR', '已读消息ID无效');
    const now = new Date().toISOString();
    if (!conversation.lastMessageId || conversation.lastMessageId !== input.lastMessageId) {
      return { conversation: directConversationDto(conversation), unread: Number(conversation.unreadByUser && conversation.unreadByUser[currentUserId]) || 0, readAt: now };
    }
    conversation.unreadByUser = { ...(conversation.unreadByUser || {}), [currentUserId]: 0 };
    conversation.readAtByUser = { ...(conversation.readAtByUser || {}), [currentUserId]: now };
    return { conversation: directConversationDto(conversation), unread: 0, readAt: now };
  }
  if (action === 'ride.driver.profile') { requireUser(); return { driver: driverProfile() }; }
  if (action === 'ride.driver.mine') {
    requireApprovedDriver();
    return {
      items: (state.rideFulfillments || [])
        .filter((item) => item.driverId === currentUserId && item.status === 'ASSIGNED')
        .map((item) => ({
          activity: publicActivity(activityById(item.activityId)),
          rideFulfillment: clone(publicActivity(activityById(item.activityId)).rideFulfillment)
        }))
    };
  }
  if (action === 'ride.driver.memberContacts') {
    requireApprovedDriver();
    const activity = activityById(input.activityId);
    const fulfillment = activity && (state.rideFulfillments || []).find((item) => item.activityId === activity.id);
    assert(activity && activity.type === 'ride' && fulfillment, 'NOT_FOUND', '行程不存在或已失效');
    assert(['RECRUITING', 'FORMED', 'IN_PROGRESS'].includes(activity.status), 'CONFLICT', '该行程当前不可查看成员联系方式');
    assert(fulfillment.status === 'ASSIGNED' && fulfillment.driverId === currentUserId, 'FORBIDDEN', '你没有权限查看成员联系方式');
    const items = state.members
      .filter((member) => member.activityId === activity.id && member.status === 'ACTIVE')
      .sort((left, right) => Date.parse(left.joinedAt) - Date.parse(right.joinedAt))
      .map((member) => {
        const contact = state.memberContacts.find((item) => item.activityId === activity.id && item.memberId === member.id && item.status === 'ACTIVE');
        assert(contact && contact.phone, 'CONTACT_INCOMPLETE', '成员联系方式尚未齐全，请稍后重试');
        const user = userById(member.userId);
        return {
          memberId: member.id,
          nickname: user && user.profile && user.profile.nickname || (member.role === 'OWNER' ? '发起者' : '乘客'),
          phone: contact.phone,
          luggageType: member.luggageType || null,
          role: member.role
        };
      });
    return { activityId: activity.id, items };
  }
  if (action === 'ride.driver.accept') { requireApprovedDriver(true); return acceptRide(input); }
  if (action === 'ride.driver.cancel') { requireApprovedDriver(true); return cancelRideAssignment(input); }
  if (action === 'application.submit') return submitApplication(input);
  if (action === 'ride.join') { requireActiveUser(true); return joinRide(input); }
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
    const contact = state.memberContacts.find((item) => item.activityId === activity.id && item.memberId === member.id);
    if (contact) Object.assign(contact, { status: 'INACTIVE', updatedAt: now });
    activity.avatarRoster = normalizeAvatarRoster(activity.avatarRoster).filter((item) => item.memberId !== member.id);
    activity.memberCount = Math.max(1, activity.memberCount - 1);
    if (activity.status === 'FORMED' && activity.memberCount < (activity.minMembers || activity.minPassengers || activity.targetMembers)) {
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
    requireActiveUser();
    return {
      items: state.notifications
        .filter((item) => item.userId === currentUserId)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .map(publicNotification)
    };
  }
  if (action === 'notification.read') {
    requireActiveUser();
    const item = state.notifications.find((notification) => notification.id === input.notificationId);
    assert(item && item.userId === currentUserId, 'FORBIDDEN', '你没有权限处理该通知');
    item.read = true;
    return { notification: publicNotification(item) };
  }
  if (action === 'report.create') {
    const user = requireActiveUser(true);
    assert(completeRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先完善个人资料');
    assert(['activity', 'user', 'communityPost', 'communityReply', 'directConversation'].includes(input.targetType), 'VALIDATION_ERROR', '举报对象类型无效');
    assert(typeof input.targetId === 'string' && input.targetId.length > 0 && input.targetId.length <= 80, 'VALIDATION_ERROR', '举报对象无效');
    assert(['FALSE_INFORMATION', 'ILLEGAL_SERVICE_SOLICITATION', 'FRAUD_OR_DIVERSION', 'HARASSMENT', 'OTHER'].includes(input.reason), 'VALIDATION_ERROR', '举报原因无效');
    assert(String(input.description || '').length <= 300, 'VALIDATION_ERROR', '举报说明过长');
    if (input.targetType === 'directConversation') {
      const conversation = state.directConversations.find((item) => item.id === input.targetId);
      assert(conversation && [conversation.participantAId, conversation.participantBId].includes(currentUserId), 'NOT_FOUND_OR_NOT_ALLOWED', '目标不存在或当前不可联系');
    }
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
    const communityPayloadHash = action === 'community.post.create' || action === 'community.reply.create'
      || action === 'dm.message.send' || action === 'group.message.send'
      ? opaqueSensitiveHash(stableSerialize(event.data || {}))
      : '';
    if (isMutation) assert(idempotencyId, 'VALIDATION_ERROR', '写操作缺少幂等键');
    if (isMutation) requireUser();
    if (idempotencyId && communityPayloadHash && state.idempotency[`${idempotencyId}:payload`]) {
      assert(state.idempotency[`${idempotencyId}:payload`] === communityPayloadHash, 'CONFLICT', '幂等键已用于其他社区内容');
    }
    if (idempotencyId && !BUSINESS_IDEMPOTENT_ACTIONS.has(action) && state.idempotency[idempotencyId]) {
      const replay = ok(clone(state.idempotency[idempotencyId]));
      replay.idempotentReplay = true;
      return replay;
    }
    const data = handle(action, event.data || {}, event.idempotencyKey || '');
    if (idempotencyId && !BUSINESS_IDEMPOTENT_ACTIONS.has(action)) {
      state.idempotency[idempotencyId] = clone(data);
      if (communityPayloadHash) state.idempotency[`${idempotencyId}:payload`] = communityPayloadHash;
    }
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
  state = initializeActivityCommunication(seedState());
  currentUserId = 'u_owner';
  persist();
}

module.exports = {
  call,
  setPersona,
  getPersona,
  reset
};
