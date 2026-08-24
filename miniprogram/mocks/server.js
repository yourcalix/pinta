'use strict';

const STATE_KEY = 'pinba_mock_state_v2';
const PERSONA_KEY = 'pinba_mock_persona_v1';
const MUTATING_ACTIONS = new Set([
  'profile.update',
  'activity.create',
  'activity.cancel',
  'activity.complete',
  'activity.question.ask',
  'activity.question.answer',
  'application.submit',
  'application.approve',
  'application.reject',
  'application.withdraw',
  'member.leave',
  'notification.read',
  'report.create',
  'admin.activity.suspend'
]);
const PUBLIC_ACTIONS = new Set(['activity.list', 'activity.detail', 'activity.question.list']);
const MAX_PUBLIC_SCAN = 500;

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

function normalizeActivityForRead(activity, now) {
  if (!activity || activity.status !== 'RECRUITING') return activity;
  const deadline = Date.parse(activity.deadlineAt);
  const at = Date.parse(now);
  if (!Number.isFinite(deadline) || !Number.isFinite(at) || deadline > at) return activity;
  return { ...activity, status: 'EXPIRED' };
}

function isoAfter(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function seedState() {
  const now = new Date().toISOString();
  return {
    sequence: 100,
    users: [
      { id: 'u_owner', role: 'user', status: 'ACTIVE', profile: { nickname: '小拼', city: '上海', interests: ['羽毛球', '咖啡'], adultConfirmed: true } },
      { id: 'u_member', role: 'user', status: 'ACTIVE', profile: { nickname: '阿同', city: '上海', interests: ['徒步', '摄影'], adultConfirmed: true } },
      { id: 'u_merchant', role: 'user', status: 'ACTIVE', profile: { nickname: '邻里团长', city: '上海', interests: ['凑单'], adultConfirmed: true } },
      { id: 'u_admin', role: 'admin', status: 'ACTIVE', profile: { nickname: '运营', city: '上海', interests: [], adultConfirmed: true } },
      { id: 'u_disabled', role: 'user', status: 'DISABLED', profile: { nickname: '受限账号', city: '上海', interests: [], adultConfirmed: true } }
    ],
    activities: [
      {
        id: 'a_ride', ownerId: 'u_owner', owner: { nickname: '小拼' }, type: 'ride',
        title: '张江到浦东机场同行', description: '周末早班机，寻找一位同路线伙伴共同预约合规车辆。',
        city: '上海', district: '浦东新区', placeLabel: '张江地铁站',
        startsAt: isoAfter(26), deadlineAt: isoAfter(18), targetMembers: 2, memberCount: 1,
        contactInfo: '微信号 pinba_xiaopin', rules: '成团后在张江地铁站附近公共区域确认具体上车点。',
        typeData: { origin: '张江', destination: '浦东机场', feeType: 'SHARED_COST', luggageRule: 'ONE_SMALL' },
        status: 'RECRUITING', version: 1, createdAt: now, updatedAt: now
      },
      {
        id: 'a_product', ownerId: 'u_merchant', owner: { nickname: '邻里团长' }, type: 'product',
        title: '精品咖啡豆四袋凑单', description: '官方旗舰店满减，成团后线下验货自提，不提前收款。',
        city: '上海', district: '徐汇区', placeLabel: '徐家汇商圈',
        startsAt: isoAfter(40), deadlineAt: isoAfter(28), targetMembers: 3, memberCount: 1,
        contactInfo: '微信号 coffee_pin_01', rules: '到货后在商场公共区域当面验货交付。',
        typeData: { productName: '中度烘焙咖啡豆', targetQuantity: 4, unitPriceRange: '58—68元/袋', shoppingChannel: '品牌官方旗舰店', deliveryMode: 'FACE_TO_FACE' },
        status: 'RECRUITING', version: 1, createdAt: now, updatedAt: now
      },
      {
        id: 'a_buddy', ownerId: 'u_owner', owner: { nickname: '小拼' }, type: 'buddy',
        title: '周末新手羽毛球双打', description: '新手友好，轻松运动一小时，场地费AA。',
        city: '上海', district: '杨浦区', placeLabel: '五角场体育馆',
        startsAt: isoAfter(10), deadlineAt: isoAfter(5), targetMembers: 2, memberCount: 2,
        contactInfo: '微信号 pinba_xiaopin', rules: '体育馆一楼前台旁会合，请自带球拍。',
        typeData: { category: '运动', costMode: 'AA', level: 'BEGINNER', equipment: '自带球拍' },
        status: 'FORMED', version: 2, formedAt: now, createdAt: now, updatedAt: now
      },
      {
        id: 'a_suspended', ownerId: 'u_owner', owner: { nickname: '小拼' }, type: 'buddy',
        title: '已下架活动测试数据', description: '仅用于验证下架状态，不应出现在公开列表或详情中。',
        city: '上海', district: '静安区', placeLabel: '测试地点',
        startsAt: isoAfter(12), deadlineAt: isoAfter(6), targetMembers: 2, memberCount: 1,
        contactInfo: '微信号 pinba_suspended', rules: '内部测试规则',
        typeData: { category: '测试', costMode: 'AA', level: 'BEGINNER', equipment: '' },
        status: 'SUSPENDED', version: 2,
        suspension: { adminId: 'admin_mock', reason: '测试运营处置原因', at: now },
        createdAt: now, updatedAt: now
      }
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
        title: '“张江到浦东机场同行”有新的加入申请', read: false, createdAt: now,
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
let currentUserId = readStorage(PERSONA_KEY) || 'u_owner';
if (!state.idempotency) state.idempotency = {};
if (!state.activityQuestions) state.activityQuestions = [];

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

function publicUser(user) {
  return user ? { role: user.role, status: user.status, profile: clone(user.profile) } : null;
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

function publicActivity(activity) {
  const viewerApplication = state.applications
    .filter((item) => item.activityId === activity.id && item.applicantId === currentUserId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const viewerMember = activeMember(activity.id, currentUserId);
  const viewerRole = activity.ownerId === currentUserId ? 'owner' : viewerMember ? 'member' : viewerApplication ? 'applicant' : 'guest';
  const { contactInfo, ownerId, version, suspension, operationKeyHash, ...safe } = activity;
  return {
    ...clone(safe),
    viewerRole,
    viewerApplication: viewerApplication ? publicApplication(viewerApplication) : undefined,
    viewerMembership: viewerMember ? clone(viewerMember) : undefined
  };
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

function assert(condition, code, message) {
  if (!condition) throw fail(code, message);
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
  let candidates = state.activities.filter((item) => ['RECRUITING', 'FORMED'].includes(item.status));
  if (input.type) candidates = candidates.filter((item) => item.type === input.type);
  if (input.city) candidates = candidates.filter((item) => item.city === input.city);
  if (input.district) candidates = candidates.filter((item) => item.district === input.district);
  candidates.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  const offset = parsePublicCursor(input.cursor);
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);
  const keyword = typeof input.keyword === 'string' ? input.keyword.toLowerCase() : '';
  const now = new Date().toISOString();
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
        return { items: items.map(publicActivity), nextCursor: String(candidateOffset) };
      }
      items.push(activity);
    }
  }

  return {
    items: items.map(publicActivity),
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
  state.activities.unshift(activity);
  state.members.push({ id: nextId('member'), activityId: activity.id, userId: user.id, role: 'OWNER', status: 'ACTIVE', joinedAt: now });
  return { activity: publicActivity(activity) };
}

function submitApplication(input) {
  const user = requireUser();
  const activity = activityById(input.activityId);
  assert(activity, 'NOT_FOUND', '活动不存在或已失效');
  assert(activity.status === 'RECRUITING', 'CONFLICT', '该活动当前不可申请');
  assert(activity.ownerId !== user.id, 'CONFLICT', '不能申请自己发布的活动');
  assert(Date.parse(activity.deadlineAt) > Date.now(), 'CONFLICT', '该活动报名已截止');
  assert(input.autoJoinConsent === true, 'VALIDATION_ERROR', '请确认获批后自动加入并占用名额');
  const duplicate = state.applications.find((item) => item.activityId === input.activityId && item.applicantId === user.id && ['PENDING', 'APPROVED'].includes(item.status));
  assert(!duplicate, 'CONFLICT', '你已经申请或加入该活动');
  const now = new Date().toISOString();
  const application = {
    id: nextId('application'), activityId: input.activityId, applicantId: user.id,
    applicant: { nickname: user.profile.nickname }, status: 'PENDING', note: input.note || '', autoJoinConsent: true,
    createdAt: now, updatedAt: now
  };
  state.applications.push(application);
  state.notifications.unshift({ id: nextId('notification'), userId: activity.ownerId, type: 'NEW_APPLICATION', activityId: activity.id, title: `“${activity.title}”有新的加入申请`, read: false, createdAt: now });
  return { application: publicApplication(application) };
}

function approveApplication(input) {
  const activity = activityById(input.activityId);
  const application = state.applications.find((item) => item.id === input.applicationId);
  assert(activity && application, 'NOT_FOUND', '申请不存在');
  assert(activity.ownerId === currentUserId, 'FORBIDDEN', '你没有权限处理该申请');
  assert(activity.status === 'RECRUITING', 'CONFLICT', '活动当前不可继续批准成员');
  assert(application.status === 'PENDING', 'CONFLICT', '该申请已处理');
  assert(activity.memberCount < activity.targetMembers, 'CAPACITY_FULL', '名额已满');
  const now = new Date().toISOString();
  application.status = 'APPROVED';
  application.approvedAt = now;
  application.updatedAt = now;
  state.members.push({ id: nextId('member'), activityId: activity.id, userId: application.applicantId, role: 'MEMBER', status: 'ACTIVE', joinedAt: now });
  activity.memberCount += 1;
  activity.version += 1;
  activity.updatedAt = now;
  if (activity.memberCount >= activity.targetMembers) {
    activity.status = 'FORMED';
    activity.formedAt = now;
    state.applications.forEach((item) => {
      if (item.activityId === activity.id && item.status === 'PENDING') item.status = 'CANCELLED_BY_ACTIVITY';
    });
  }
  state.notifications.unshift({
    id: nextId('notification'), userId: application.applicantId,
    type: activity.status === 'FORMED' ? 'GROUP_FORMED' : 'APPLICATION_APPROVED', activityId: activity.id,
    title: activity.status === 'FORMED' ? `“${activity.title}”已成团` : `你已加入“${activity.title}”`, read: false, createdAt: now
  });
  return { activity: publicActivity(activity), application: publicApplication(application) };
}

function handle(action, input) {
  if (!PUBLIC_ACTIONS.has(action)) requireUser();
  if (action === 'auth.login') return { user: publicUser(requireUser()), sessionScope: `mock-session-${currentUserId}` };
  if (action === 'profile.get') return { user: publicUser(requireUser()) };
  if (action === 'profile.update') {
    const user = requireUser();
    user.profile = clone(input);
    return { user: publicUser(user) };
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
  if (action === 'application.submit') return submitApplication(input);
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
    member.status = 'LEFT';
    member.leaveReason = input.reason || '';
    member.leftAt = new Date().toISOString();
    activity.memberCount = Math.max(1, activity.memberCount - 1);
    if (activity.status === 'FORMED') activity.status = 'RECRUITING';
    return { activity: publicActivity(activity) };
  }
  if (action === 'activity.cancel') {
    const activity = activityById(input.activityId);
    assert(activity && activity.ownerId === currentUserId, 'FORBIDDEN', '你没有权限取消该活动');
    if (activity.status !== 'CANCELLED') {
      assert(['RECRUITING', 'FORMED'].includes(activity.status), 'CONFLICT', '当前状态不能取消活动');
      activity.status = 'CANCELLED';
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
    if (idempotencyId && state.idempotency[idempotencyId]) {
      const replay = ok(clone(state.idempotency[idempotencyId]));
      replay.idempotentReplay = true;
      return replay;
    }
    const data = handle(action, event.data || {});
    if (idempotencyId) state.idempotency[idempotencyId] = clone(data);
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
