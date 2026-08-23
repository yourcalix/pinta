'use strict';

const STATE_KEY = 'pinba_mock_state_v2';
const PERSONA_KEY = 'pinba_mock_persona_v1';
const MUTATING_ACTIONS = new Set([
  'profile.update',
  'activity.create',
  'activity.cancel',
  'activity.complete',
  'application.submit',
  'application.approve',
  'application.reject',
  'application.withdraw',
  'member.leave',
  'notification.read',
  'report.create',
  'admin.activity.suspend'
]);

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
      { id: 'u_merchant', role: 'user', status: 'ACTIVE', profile: { nickname: '邻里团长', city: '上海', interests: ['凑单'], adultConfirmed: true } }
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
      { id: 'n_owner_apply', userId: 'u_owner', type: 'NEW_APPLICATION', activityId: 'a_ride', title: '“张江到浦东机场同行”有新的加入申请', read: false, createdAt: now },
      { id: 'n_member_formed', userId: 'u_member', type: 'GROUP_FORMED', activityId: 'a_buddy', title: '“周末新手羽毛球双打”已成团', read: false, createdAt: now }
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
  const { userId, ...safe } = notification;
  return clone(safe);
}

function publicActivity(activity) {
  const viewerApplication = state.applications
    .filter((item) => item.activityId === activity.id && item.applicantId === currentUserId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const viewerMember = activeMember(activity.id, currentUserId);
  const viewerRole = activity.ownerId === currentUserId ? 'owner' : viewerMember ? 'member' : viewerApplication ? 'applicant' : 'guest';
  const { contactInfo, ownerId, version, ...safe } = activity;
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
  return user;
}

function assert(condition, code, message) {
  if (!condition) throw fail(code, message);
}

function listActivities(input) {
  let items = state.activities.filter((item) => ['RECRUITING', 'FORMED'].includes(item.status));
  if (input.type) items = items.filter((item) => item.type === input.type);
  if (input.city) items = items.filter((item) => item.city === input.city);
  if (input.district) items = items.filter((item) => item.district === input.district);
  if (input.keyword) {
    const keyword = input.keyword.toLowerCase();
    items = items.filter((item) => `${item.title} ${item.description}`.toLowerCase().includes(keyword));
  }
  items.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return { items: items.map(publicActivity), nextCursor: null };
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
  if (action === 'auth.login') return { user: publicUser(requireUser()), sessionScope: `mock-session-${currentUserId}` };
  if (action === 'profile.get') return { user: publicUser(requireUser()) };
  if (action === 'profile.update') {
    const user = requireUser();
    user.profile = clone(input);
    return { user: publicUser(user) };
  }
  if (action === 'activity.list') return listActivities(input);
  if (action === 'activity.detail') {
    const activity = activityById(input.activityId);
    assert(activity && activity.status !== 'SUSPENDED', 'NOT_FOUND', '活动不存在或已失效');
    return { activity: publicActivity(activity) };
  }
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
