'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPinbaService } = require('../cloudfunctions/api/lib/service');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');
const { validateActivityInput } = require('../cloudfunctions/api/lib/validation');
const { createWechatModeration } = require('../cloudfunctions/api/lib/moderation');

const NOW = new Date('2026-08-23T02:00:00.000Z');

function user(id, nickname, role = 'user') {
  return {
    id,
    role,
    status: 'ACTIVE',
    profile: {
      nickname,
      gender: 'MALE',
      city: '澳门',
      interests: ['咖啡'],
      adultConfirmed: true
    },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString()
  };
}

function setup() {
  const store = new MemoryStore({
    users: [
      user('owner-openid', '发起者'),
      user('member-openid', '参与者'),
      user('other-openid', '路人'),
      user('second-openid', '候补'),
      user('admin-openid', '运营', 'admin'),
      { ...user('disabled-openid', '受限账号'), status: 'DISABLED' }
    ],
    studentVerifications: ['owner-openid', 'member-openid', 'other-openid', 'second-openid', 'admin-openid'].map((userId) => ({
      id: userId, userId, status: 'APPROVED', revision: 1, updatedAt: NOW.toISOString()
    }))
  });
  let sequence = 0;
  const service = createPinbaService({
    store,
    clock: () => new Date(NOW),
    idGenerator: () => `id-${++sequence}`
  });
  let requests = 0;
  async function call(action, data = {}, actorId = null, key) {
    requests += 1;
    return service.execute({
      action,
      data,
      requestId: `request-${requests}`,
      ...(key ? { idempotencyKey: key } : {})
    }, actorId ? { actorId } : {});
  }
  return { store, service, call };
}

function rideInput(overrides = {}) {
  return {
    type: 'ride',
    title: '青茂口岸到凼仔校区拼车',
    description: '寻找同路线伙伴，共同预约合规交通工具',
    city: '澳门',
    district: '澳门校园',
    placeLabel: '青茂口岸 → 凼仔校区',
    startsAt: '2026-08-24T02:00:00.000Z',
    deadlineAt: '2026-08-23T14:00:00.000Z',
    minPassengers: 7,
    maxPassengers: 7,
    luggageType: 'SMALL',
    contactInfo: '+85361234567',
    rules: '成团后在公共地点会合',
    typeData: {
      routeId: 'QINGMAO_TO_TAIPA',
      pickupWindowEnd: '2026-08-24T03:00:00.000Z',
      feeType: 'SHARED_COST'
    },
    ...overrides
  };
}

test('CloudBase 事务只使用官方支持的 doc 文档引用', () => {
  const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/api/lib/cloud-store.js'), 'utf8');
  assert.doesNotMatch(source, /transaction\.collection\([^)]*\)\s*\.where/s);
});

test('拼车费用只允许枚举且拒绝具体收费金额', () => {
  assert.throws(
    () => validateActivityInput(rideInput({ description: '每人收取50元' }), NOW),
    (error) => error.code === 'VALIDATION_ERROR' && /收费金额/.test(error.message)
  );
  const valid = validateActivityInput(rideInput(), NOW);
  assert.equal(valid.typeData.feeType, 'SHARED_COST');
});

test('游客可浏览，公开 DTO 不泄露联系方式或 openid', async () => {
  const { call, store } = setup();
  const created = await call('activity.create', rideInput(), 'owner-openid', 'create-public-001');
  store.activities.get(created.data.activity.id).owner.id = 'owner-openid';
  assert.equal(created.ok, true);
  const detail = await call('activity.detail', { activityId: created.data.activity.id });
  assert.equal(detail.ok, true);
  assert.equal(detail.data.activity.contactInfo, undefined);
  assert.deepEqual(detail.data.activity.owner, { nickname: '发起者' });
  assert.equal(JSON.stringify(detail.data).includes('owner-openid'), false);
});

test('登录只返回不可逆会话作用域而不返回 openid', async () => {
  const { call } = setup();
  const loggedIn = await call('auth.login', {}, 'owner-openid');
  assert.equal(loggedIn.ok, true);
  assert.match(loggedIn.data.sessionScope, /^session_[a-f0-9]{56}$/);
  assert.equal(JSON.stringify(loggedIn.data).includes('owner-openid'), false);
});

test('受限账号登录和受保护动作统一返回 ACCOUNT_DISABLED', async () => {
  const { call } = setup();
  const loggedIn = await call('auth.login', {}, 'disabled-openid');
  assert.equal(loggedIn.ok, false);
  assert.deepEqual(loggedIn.error, {
    code: 'ACCOUNT_DISABLED',
    message: '账号已被限制，请联系平台处理'
  });

  const mine = await call('activity.mine', {}, 'disabled-openid');
  assert.equal(mine.ok, false);
  assert.equal(mine.error.code, 'ACCOUNT_DISABLED');

  const created = await call('activity.create', rideInput(), 'disabled-openid', 'disabled-create-001');
  assert.equal(created.ok, false);
  assert.equal(created.error.code, 'ACCOUNT_DISABLED');
});

test('账号停用后不能通过旧幂等键重放成功结果', async () => {
  const { call, store } = setup();
  const key = 'disabled-replay-001';
  const created = await call('activity.create', rideInput(), 'owner-openid', key);
  assert.equal(created.ok, true);

  store.users.get('owner-openid').status = 'DISABLED';
  const replay = await call('activity.create', rideInput(), 'owner-openid', key);
  assert.equal(replay.ok, false);
  assert.equal(replay.error.code, 'ACCOUNT_DISABLED');
  assert.equal(store.activities.size, 1);
});

test('公开列表忽略调用方伪造的非公开状态过滤', async () => {
  const { call } = setup();
  const created = await call('activity.create', rideInput(), 'owner-openid', 'create-hidden-status-001');
  await call('activity.cancel', {
    activityId: created.data.activity.id,
    reason: '计划变更'
  }, 'owner-openid', 'cancel-hidden-status-001');
  const page = await call('activity.list', { status: 'CANCELLED' });
  assert.equal(page.ok, true);
  assert.equal(page.data.items.some((item) => item.id === created.data.activity.id), false);
});

test('运营下架活动从公开列表消失且直达详情返回 TAKEDOWN', async () => {
  const { call } = setup();
  const created = await call('activity.create', rideInput(), 'owner-openid', 'create-takedown-001');
  const activityId = created.data.activity.id;
  const suspended = await call('admin.activity.suspend', {
    activityId,
    reason: '测试运营处置原因'
  }, 'admin-openid', 'suspend-takedown-001');
  assert.equal(suspended.ok, true);
  assert.equal(suspended.data.activity.status, 'SUSPENDED');
  assert.equal(JSON.stringify(suspended.data).includes('admin-openid'), false);
  assert.equal(JSON.stringify(suspended.data).includes('测试运营处置原因'), false);

  const page = await call('activity.list');
  assert.equal(page.data.items.some((item) => item.id === activityId), false);

  const detail = await call('activity.detail', { activityId });
  assert.equal(detail.ok, false);
  assert.deepEqual(detail.error, {
    code: 'TAKEDOWN',
    message: '该活动已被平台处理，暂不可查看'
  });
});

test('申请时必须同意获批后自动占位', async () => {
  const { call } = setup();
  const created = await call('activity.create', rideInput(), 'owner-openid', 'create-consent-001');
  const denied = await call('application.submit', {
    activityId: created.data.activity.id,
    note: '时间合适',
    autoJoinConsent: false
  }, 'member-openid', 'apply-consent-001');
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'VALIDATION_ERROR');
});

test('发起者批准即原子占位且七人前保持招募', async () => {
  const { call, store } = setup();
  const created = await call('activity.create', rideInput(), 'owner-openid', 'create-form-001');
  const activityId = created.data.activity.id;
  const applied = await call('application.submit', {
    activityId,
    note: '带一个小行李箱',
    autoJoinConsent: true
  }, 'member-openid', 'apply-form-001');
  assert.equal(applied.ok, true);
  const approved = await call('application.approve', {
    activityId,
    applicationId: applied.data.application.id
  }, 'owner-openid', 'approve-form-001');
  assert.equal(approved.ok, true);
  assert.equal(approved.data.activity.status, 'RECRUITING');
  assert.equal(approved.data.activity.memberCount, 2);
  assert.equal(approved.data.application.status, 'APPROVED');
  assert.equal(store.members.size, 2);
});

test('最后名额不会被重复批准或超员', async () => {
  const { call, store } = setup();
  const created = await call('activity.create', rideInput(), 'owner-openid', 'create-capacity-001');
  const activityId = created.data.activity.id;
  store.activities.get(activityId).memberCount = 6;
  const first = await call('application.submit', { activityId, note: '', autoJoinConsent: true }, 'member-openid', 'apply-capacity-001');
  const second = await call('application.submit', { activityId, note: '', autoJoinConsent: true }, 'second-openid', 'apply-capacity-002');
  const approved = await call('application.approve', { activityId, applicationId: first.data.application.id }, 'owner-openid', 'approve-capacity-001');
  assert.equal(approved.ok, true);
  const rejectedByState = await call('application.approve', { activityId, applicationId: second.data.application.id }, 'owner-openid', 'approve-capacity-002');
  assert.equal(rejectedByState.ok, false);
  assert.equal(rejectedByState.error.code, 'CONFLICT');
  assert.equal((await store.getActivity(activityId)).memberCount, 7);
});

test('只有七人满员后的有效成员可以读取联系方式', async () => {
  const { call, store } = setup();
  const created = await call('activity.create', rideInput(), 'owner-openid', 'create-contact-001');
  const activityId = created.data.activity.id;
  const beforeFormed = await call('group.contact', { activityId }, 'owner-openid');
  assert.equal(beforeFormed.ok, false);
  assert.equal(beforeFormed.error.code, 'CONFLICT');

  const applied = await call('application.submit', { activityId, note: '', autoJoinConsent: true }, 'member-openid', 'apply-contact-001');
  await call('application.approve', { activityId, applicationId: applied.data.application.id }, 'owner-openid', 'approve-contact-001');
  store.activities.get(activityId).memberCount = 7;
  store.activities.get(activityId).status = 'FORMED';
  for (let index = 0; index < 5; index += 1) {
    store.members.set(`contact-member-${index}`, {
      id: `contact-member-${index}`,
      activityId,
      userId: `contact-user-${index}`,
      role: 'MEMBER',
      status: 'ACTIVE',
      joinedAt: NOW.toISOString()
    });
  }

  const outsider = await call('group.contact', { activityId }, 'other-openid');
  assert.equal(outsider.ok, false);
  assert.equal(outsider.error.code, 'FORBIDDEN');
  const member = await call('group.contact', { activityId }, 'member-openid');
  assert.equal(member.ok, true);
  assert.equal(member.data.contactInfo, undefined);
});

test('相同幂等键重放不会重复创建活动', async () => {
  const { call, store } = setup();
  const first = await call('activity.create', rideInput(), 'owner-openid', 'same-create-key-001');
  const second = await call('activity.create', rideInput(), 'owner-openid', 'same-create-key-001');
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.idempotentReplay, true);
  assert.equal(second.data.activity.id, first.data.activity.id);
  assert.equal(store.activities.size, 1);
});

test('业务已落库但审计暂时失败时，同一幂等键可安全恢复', async () => {
  const { call, store } = setup();
  const originalAddAudit = store.addAudit.bind(store);
  let failOnce = true;
  store.addAudit = async (audit) => {
    if (failOnce) {
      failOnce = false;
      throw new Error('temporary audit failure');
    }
    return originalAddAudit(audit);
  };
  const first = await call('activity.create', rideInput(), 'owner-openid', 'create-recoverable-001');
  assert.equal(first.ok, false);
  const retried = await call('activity.create', rideInput(), 'owner-openid', 'create-recoverable-001');
  assert.equal(retried.ok, true);
  assert.equal(store.activities.size, 1);
  assert.equal(store.members.size, 1);
  assert.equal(store.auditLogs.size, 1);
  assert.equal(store.idempotency.size, 1);
});

test('申请写入后审计失败可用同一键恢复且不重复通知', async () => {
  const { call, store } = setup();
  const created = await call('activity.create', rideInput(), 'owner-openid', 'create-apply-recovery-001');
  const originalAddAudit = store.addAudit.bind(store);
  let failOnce = true;
  store.addAudit = async (audit) => {
    if (failOnce) {
      failOnce = false;
      throw new Error('temporary audit failure');
    }
    return originalAddAudit(audit);
  };
  const input = { activityId: created.data.activity.id, note: '同行', autoJoinConsent: true };
  const first = await call('application.submit', input, 'member-openid', 'apply-recoverable-001');
  assert.equal(first.ok, false);
  const retried = await call('application.submit', input, 'member-openid', 'apply-recoverable-001');
  assert.equal(retried.ok, true);
  assert.equal(store.applications.size, 1);
  assert.equal(store.notifications.size, 1);
});

test('同一用户更换幂等键并发语义下仍不能重复申请', async () => {
  const { call, store } = setup();
  const created = await call('activity.create', rideInput(), 'owner-openid', 'create-duplicate-application-001');
  const data = { activityId: created.data.activity.id, note: '', autoJoinConsent: true };
  const first = await call('application.submit', data, 'member-openid', 'apply-duplicate-application-001');
  const second = await call('application.submit', data, 'member-openid', 'apply-duplicate-application-002');
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.error.code, 'CONFLICT');
  assert.equal(store.applications.size, 1);
});

test('取消活动后关闭待处理申请且不能再批准', async () => {
  const { call, store } = setup();
  const created = await call('activity.create', rideInput(), 'owner-openid', 'create-cancel-race-001');
  const activityId = created.data.activity.id;
  const applied = await call('application.submit', {
    activityId,
    note: '',
    autoJoinConsent: true
  }, 'member-openid', 'apply-cancel-race-001');
  const cancelled = await call('activity.cancel', { activityId, reason: '计划变化' }, 'owner-openid', 'cancel-race-001');
  assert.equal(cancelled.ok, true);
  assert.equal(store.applications.get(applied.data.application.id).status, 'CANCELLED_BY_ACTIVITY');
  const approved = await call('application.approve', {
    activityId,
    applicationId: applied.data.application.id
  }, 'owner-openid', 'approve-after-cancel-001');
  assert.equal(approved.ok, false);
  assert.equal(approved.error.code, 'CONFLICT');
});

test('申请、审批和通知 DTO 不暴露内部用户标识或联系方式', async () => {
  const { call } = setup();
  const created = await call('activity.create', rideInput(), 'owner-openid', 'create-dto-safety-001');
  const activityId = created.data.activity.id;
  const applied = await call('application.submit', {
    activityId,
    note: '测试脱敏',
    autoJoinConsent: true
  }, 'member-openid', 'apply-dto-safety-001');
  assert.equal(JSON.stringify(applied.data).includes('member-openid'), false);

  const ownerNotifications = await call('notification.list', {}, 'owner-openid');
  assert.equal(ownerNotifications.ok, true);
  assert.equal(ownerNotifications.data.items[0].target, 'MANAGE');

  const ownerList = await call('application.listForOwner', { activityId }, 'owner-openid');
  assert.equal(ownerList.ok, true);
  assert.deepEqual(ownerList.data.items[0].applicant, { nickname: '参与者' });
  assert.equal(ownerList.data.items[0].applicantId, undefined);

  const approved = await call('application.approve', {
    activityId,
    applicationId: applied.data.application.id
  }, 'owner-openid', 'approve-dto-safety-001');
  const approvalJson = JSON.stringify(approved.data);
  assert.equal(approvalJson.includes('owner-openid'), false);
  assert.equal(approvalJson.includes('member-openid'), false);
  assert.equal(approvalJson.includes('pinba_demo'), false);

  const notifications = await call('notification.list', {}, 'member-openid');
  assert.equal(notifications.ok, true);
  assert.equal(notifications.data.items[0].userId, undefined);
  assert.equal(notifications.data.items[0].target, 'DETAIL');
  assert.equal(notifications.data.items[0].url, undefined);
  assert.equal(notifications.data.items[0].page, undefined);
});

test('非发起者不能审批申请', async () => {
  const { call } = setup();
  const created = await call('activity.create', rideInput(), 'owner-openid', 'create-authz-001');
  const activityId = created.data.activity.id;
  const applied = await call('application.submit', { activityId, note: '', autoJoinConsent: true }, 'member-openid', 'apply-authz-001');
  const result = await call('application.approve', { activityId, applicationId: applied.data.application.id }, 'other-openid', 'approve-authz-001');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'FORBIDDEN');
});

test('举报立即对举报者隐藏且阻止重复举报', async () => {
  const { call } = setup();
  const created = await call('activity.create', rideInput(), 'owner-openid', 'create-report-001');
  const payload = {
    targetType: 'activity',
    targetId: created.data.activity.id,
    reason: 'FALSE_INFORMATION',
    description: '信息与实际情况不一致'
  };
  const first = await call('report.create', payload, 'member-openid', 'report-create-001');
  assert.equal(first.ok, true);
  assert.equal(first.data.hiddenForReporter, true);
  const duplicate = await call('report.create', payload, 'member-openid', 'report-create-002');
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, 'CONFLICT');
});

test('生产环境未启用微信内容安全时拒绝用户生成内容', async () => {
  const moderation = createWechatModeration({}, { production: true, enabled: false });
  await assert.rejects(
    () => moderation.check(['普通活动内容'], { actorId: 'member-openid' }),
    (error) => error.code === 'INTERNAL' && /未配置/.test(error.message)
  );
});

test('Cloud 满员审批的已批准重放仍会触发待申请补偿收尾', () => {
  const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/api/lib/cloud-store.js'), 'utf8');
  const approvedReplay = source.match(/if \(application\.status === APPLICATION_STATUS\.APPROVED\)[\s\S]*?reachedCapacity:[\s\S]*?\n\s*};/);
  assert.ok(approvedReplay);
  assert.match(approvedReplay[0], /reachedCapacity:\s*effectiveActivity\.memberCount >= capacity/);
  assert.match(source, /if \(result\.reachedCapacity\)[\s\S]*?closePendingApplications\(activityId, at\)/);
});

test('Cloud 拼车列表与退团始终读取接车事实源并对 in 查询分片', () => {
  const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/api/lib/cloud-store.js'), 'utf8');
  assert.match(source, /CLOUD_IN_QUERY_CHUNK_SIZE\s*=\s*10/);
  assert.match(source, /rideIds\.slice\(index, index \+ CLOUD_IN_QUERY_CHUNK_SIZE\)/);
  const leaveBlock = source.match(/async leaveActivity\([\s\S]*?\n  async cancelActivity/);
  assert.ok(leaveBlock);
  assert.match(leaveBlock[0], /collection\('rideFulfillments'\)/);
  assert.match(leaveBlock[0], /stableEntityId\('rideFulfillment', activityId\)/);
  assert.match(leaveBlock[0], /isRideJoinable\(nextActivity, at\)/);
  assert.doesNotMatch(source, /command\.in\(ids\)/);
  assert.doesNotMatch(source, /command\.in\(activityIds\)/);
  assert.match(source, /fetchActivitiesByIdsChunked\(ids\)/);
  assert.match(source, /fetchActivitiesByIdsChunked\(activityIds\)/);
  assert.match(source, /filters\.viewMode === 'driver'[\s\S]*?pickupWindowEnd\) > Date\.parse\(at\)/);
});

test('Mock 拼车申请与审批允许司机确认后继续补足七名乘客', () => {
  const source = fs.readFileSync(path.join(__dirname, '../miniprogram/mocks/server.js'), 'utf8');
  const helper = source.match(/function isMockRideJoinable\([\s\S]*?\n}/);
  assert.ok(helper);
  assert.doesNotMatch(helper[0], /fulfillment\.status !== 'UNASSIGNED'/);
  const submit = source.match(/function submitApplication\([\s\S]*?\n}/);
  const approve = source.match(/function approveApplication\([\s\S]*?\n}/);
  assert.ok(submit && approve);
  assert.match(submit[0], /isMockRideJoinable\(activity, now\)/);
  assert.match(approve[0], /isMockRideJoinable\(activity, now\)/);
  assert.doesNotMatch(source, /\|\| \{ status: 'UNASSIGNED', pickupAt: null \}/);
});
