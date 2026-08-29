'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mockServer = require('../miniprogram/mocks/server');

async function call(action, data = {}) {
  return mockServer.call({ action, data, requestId: `test:${action}`, idempotencyKey: `test:${action}:12345678` });
}

test('Mock 模式可以审批乘客且七人满员前保持招募', async () => {
  mockServer.reset();
  mockServer.setPersona('u_owner');
  const applications = await call('application.listForOwner', { activityId: 'a_ride' });
  assert.equal(applications.ok, true);
  assert.equal(applications.data.items[0].status, 'PENDING');
  const ownerNotifications = await call('notification.list');
  assert.equal(ownerNotifications.data.items[0].target, 'MANAGE');
  assert.equal(ownerNotifications.data.items[0].userId, undefined);
  assert.equal(ownerNotifications.data.items[0].url, undefined);
  assert.equal(ownerNotifications.data.items[0].page, undefined);

  const approved = await call('application.approve', {
    activityId: 'a_ride',
    applicationId: applications.data.items[0].id
  });
  assert.equal(approved.ok, true);
  assert.equal(approved.data.activity.status, 'RECRUITING');

  mockServer.setPersona('u_member');
  const memberNotifications = await call('notification.list');
  assert.equal(memberNotifications.data.items[0].target, 'DETAIL');
  const contact = await call('group.contact', { activityId: 'a_ride' });
  assert.equal(contact.ok, false);
  assert.equal(contact.error.code, 'CONFLICT');
});

test('Mock 模式下举报后记录即时隐藏信号', async () => {
  mockServer.reset();
  mockServer.setPersona('u_member');
  const result = await call('report.create', {
    targetType: 'activity',
    targetId: 'a_product',
    reason: 'FALSE_INFORMATION',
    description: '测试举报'
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.hiddenForReporter, true);
});

test('Mock 拼车直接入团对空参数返回受控校验错误', async () => {
  mockServer.reset();
  mockServer.setPersona('u_member');
  const result = await call('ride.join');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'VALIDATION_ERROR');
});

test('Mock 写操作支持同一幂等键回放且取消会关闭待处理申请', async () => {
  mockServer.reset();
  mockServer.setPersona('u_owner');
  const event = {
    action: 'activity.cancel',
    data: { activityId: 'a_ride', reason: '测试取消' },
    requestId: 'test:cancel',
    idempotencyKey: 'test:cancel:same-key'
  };
  const first = await mockServer.call(event);
  const replay = await mockServer.call(event);
  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotentReplay, true);
  const applications = await call('application.listForOwner', { activityId: 'a_ride' });
  assert.equal(applications.data.items[0].status, 'CANCELLED_BY_ACTIVITY');
});

test('Mock 对齐账号受限与活动下架错误契约', async () => {
  mockServer.reset();
  assert.equal(mockServer.setPersona('u_disabled'), true);

  const login = await call('auth.login');
  assert.equal(login.ok, false);
  assert.deepEqual(login.error, {
    code: 'ACCOUNT_DISABLED',
    message: '账号已被限制，请联系平台处理'
  });

  const page = await call('activity.list');
  assert.equal(page.ok, true);
  assert.equal(page.data.items.some((item) => item.id === 'a_suspended'), false);

  const detail = await call('activity.detail', { activityId: 'a_suspended' });
  assert.equal(detail.ok, false);
  assert.deepEqual(detail.error, {
    code: 'TAKEDOWN',
    message: '该活动已被平台处理，暂不可查看'
  });
  assert.equal(JSON.stringify(detail).includes('pinba_suspended'), false);
  assert.equal(JSON.stringify(detail).includes('admin_mock'), false);
});

test('Mock 账号停用后也不能命中旧幂等成功结果', async () => {
  const storage = {};
  global.wx = {
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => { storage[key] = value; }
  };

  try {
    mockServer.reset();
    mockServer.setPersona('u_owner');
    const event = {
      action: 'activity.cancel',
      data: { activityId: 'a_ride', reason: '测试停用后的回放' },
      requestId: 'test:disabled-replay',
      idempotencyKey: 'test:disabled-replay:same-key'
    };
    const first = await mockServer.call(event);
    assert.equal(first.ok, true);

    const owner = storage.pinba_mock_state_v2.users.find((item) => item.id === 'u_owner');
    owner.status = 'DISABLED';
    const replay = await mockServer.call(event);
    assert.equal(replay.ok, false);
    assert.equal(replay.error.code, 'ACCOUNT_DISABLED');
  } finally {
    delete global.wx;
    mockServer.reset();
  }
});

test('Mock 管理员可以下架活动且响应不泄露处置详情', async () => {
  mockServer.reset();
  assert.equal(mockServer.setPersona('u_admin'), true);
  const suspended = await call('admin.activity.suspend', {
    activityId: 'a_product',
    reason: '测试管理员处置原因'
  });
  assert.equal(suspended.ok, true);
  assert.equal(suspended.data.activity.status, 'SUSPENDED');
  assert.equal(JSON.stringify(suspended.data).includes('u_admin'), false);
  assert.equal(JSON.stringify(suspended.data).includes('测试管理员处置原因'), false);

  const detail = await call('activity.detail', { activityId: 'a_product' });
  assert.equal(detail.ok, false);
  assert.equal(detail.error.code, 'TAKEDOWN');
});

test('Mock 公开列表执行游标分页且拒绝畸形游标', async () => {
  mockServer.reset();
  mockServer.setPersona('u_owner');
  const first = await call('activity.list', { limit: 2 });
  assert.equal(first.ok, true);
  assert.equal(first.data.items.length, 2);
  assert.equal(typeof first.data.nextCursor, 'string');

  const second = await call('activity.list', { limit: 2, cursor: first.data.nextCursor });
  assert.equal(second.ok, true);
  assert.equal(second.data.items.length, 1);
  assert.equal(second.data.nextCursor, null);
  assert.equal(new Set([...first.data.items, ...second.data.items].map((item) => item.id)).size, 3);

  const invalid = await call('activity.list', { limit: 2, cursor: '1.5' });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'VALIDATION_ERROR');
});

test('Mock 公开列表按校区在分页前筛选并拒绝未知校区', async () => {
  const storage = {};
  global.wx = {
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => { storage[key] = value; }
  };

  try {
    mockServer.reset();
    const source = storage.pinba_mock_state_v2.activities.find((item) => item.id === 'a_ride');
    const reverse = {
      ...source,
      id: 'a_taipa_reverse',
      title: '凼仔校区返程',
      placeLabel: '凼仔校区 → 横琴口岸',
      startsAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      deadlineAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      typeData: {
        ...source.typeData,
        routeId: 'TAIPA_TO_HENGQIN',
        routeCode: '城琴',
        origin: { id: 'TAIPA_CAMPUS', label: '凼仔校区' },
        destination: { id: 'HENGQIN', label: '横琴口岸' },
        pickupWindowEnd: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString()
      }
    };
    const dragon = {
      ...reverse,
      id: 'a_dragon',
      title: '金龙校区行程',
      placeLabel: '青茂口岸 → 金龙校区',
      typeData: {
        ...reverse.typeData,
        routeId: 'QINGMAO_TO_GOLDEN_DRAGON',
        routeCode: '青龍',
        origin: { id: 'QINGMAO', label: '青茂口岸' },
        destination: { id: 'GOLDEN_DRAGON_CAMPUS', label: '金龙校区' }
      }
    };
    storage.pinba_mock_state_v2.activities.push(reverse, dragon);
    storage.pinba_mock_state_v2.rideFulfillments.push(
      { activityId: reverse.id, status: 'UNASSIGNED', pickupAt: null, driverId: null, vehicleId: null },
      { activityId: dragon.id, status: 'UNASSIGNED', pickupAt: null, driverId: null, vehicleId: null }
    );

    const taipa = await call('activity.list', {
      type: 'ride', campusId: 'TAIPA_CAMPUS', limit: 10
    });
    assert.equal(taipa.ok, true);
    assert.deepEqual(new Set(taipa.data.items.map((item) => item.id)), new Set(['a_ride', reverse.id]));

    const goldenDragon = await call('activity.list', {
      type: 'ride', campusId: 'GOLDEN_DRAGON_CAMPUS', limit: 10
    });
    assert.equal(goldenDragon.ok, true);
    assert.deepEqual(goldenDragon.data.items.map((item) => item.id), [dragon.id]);

    const invalid = await call('activity.list', {
      type: 'ride', campusId: 'UNKNOWN_CAMPUS', limit: 10
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error.code, 'VALIDATION_ERROR');
  } finally {
    delete global.wx;
    mockServer.reset();
  }
});

test('Mock 公开列表与详情对截止活动使用一致的读时状态且不污染存储', async () => {
  const storage = {};
  global.wx = {
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => { storage[key] = value; }
  };

  try {
    mockServer.reset();
    const stored = storage.pinba_mock_state_v2.activities.find((item) => item.id === 'a_product');
    stored.deadlineAt = new Date(Date.now() - 60 * 1000).toISOString();

    const page = await call('activity.list', { limit: 10 });
    assert.equal(page.ok, true);
    assert.equal(page.data.items.some((item) => item.id === stored.id), false);

    const detail = await call('activity.detail', { activityId: stored.id });
    assert.equal(detail.ok, true);
    assert.equal(detail.data.activity.status, 'EXPIRED');
    assert.equal(stored.status, 'RECRUITING');

    mockServer.setPersona('u_member');
    const application = await call('application.submit', {
      activityId: stored.id,
      note: '截止后不应允许申请',
      autoJoinConsent: true
    });
    assert.equal(application.ok, false);
    assert.equal(application.error.code, 'CONFLICT');
  } finally {
    delete global.wx;
    mockServer.reset();
  }
});

test('Mock 在稀疏关键词与过期候选交错时仍按 raw cursor 找全结果', async () => {
  const storage = {};
  global.wx = {
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => { storage[key] = value; }
  };

  try {
    mockServer.reset();
    const source = storage.pinba_mock_state_v2.activities.find((item) => item.id === 'a_ride');
    storage.pinba_mock_state_v2.activities = Array.from({ length: 7 }, (_, index) => ({
      ...source,
      id: `a_sparse_${index}`,
      title: index % 2 === 0 ? `稀疏命中 ${index}` : `普通候选 ${index}`,
      startsAt: new Date(Date.now() + (index + 2) * 60 * 60 * 1000).toISOString(),
      deadlineAt: index === 2
        ? new Date(Date.now() - 60 * 1000).toISOString()
        : new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      status: 'RECRUITING'
    }));
    storage.pinba_mock_state_v2.rideFulfillments = Array.from({ length: 7 }, (_, index) => ({
      activityId: `a_sparse_${index}`,
      status: 'UNASSIGNED',
      pickupAt: null,
      driverId: null,
      vehicleId: null
    }));

    const first = await call('activity.list', { limit: 2, keyword: '稀疏命中' });
    assert.deepEqual(first.data.items.map((item) => item.id), ['a_sparse_0', 'a_sparse_4']);
    assert.equal(first.data.nextCursor, '6');

    const second = await call('activity.list', {
      limit: 2,
      keyword: '稀疏命中',
      cursor: first.data.nextCursor
    });
    assert.deepEqual(second.data.items.map((item) => item.id), ['a_sparse_6']);
    assert.equal(second.data.nextCursor, null);
  } finally {
    delete global.wx;
    mockServer.reset();
  }
});

test('Mock 满员但未承接的成团行程仍对司机可见', async () => {
  const storage = {};
  global.wx = {
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => { storage[key] = value; }
  };

  try {
    mockServer.reset();
    const ride = storage.pinba_mock_state_v2.activities.find((item) => item.id === 'a_ride');
    const fulfillment = storage.pinba_mock_state_v2.rideFulfillments.find((item) => item.activityId === 'a_ride');
    ride.status = 'FORMED';
    ride.memberCount = ride.maxPassengers;
    fulfillment.status = 'UNASSIGNED';

    const result = await call('activity.list', { type: 'ride', viewMode: 'driver', limit: 10 });
    assert.equal(result.ok, true);
    assert.equal(result.data.items.some((item) => item.id === 'a_ride'), true);
  } finally {
    delete global.wx;
    mockServer.reset();
  }
});

test('Mock 公开问答支持游客读取、用户提问与发起者唯一回答', async () => {
  mockServer.reset();
  const initial = await call('activity.question.list', { activityId: 'a_ride', limit: 10 });
  assert.equal(initial.ok, true);
  assert.ok(initial.data.items.length >= 1);
  assert.equal(JSON.stringify(initial.data).includes('u_member'), false);

  mockServer.setPersona('u_member');
  const asked = await call('activity.question.ask', {
    activityId: 'a_ride',
    content: '可以再带一个随身背包吗？'
  });
  assert.equal(asked.ok, true);
  assert.equal(asked.data.question.answer, null);

  mockServer.setPersona('u_owner');
  const answered = await call('activity.question.answer', {
    activityId: 'a_ride',
    questionId: asked.data.question.id,
    content: '可以，请保持行李轻便。'
  });
  assert.equal(answered.ok, true);
  assert.equal(answered.data.question.answer.content, '可以，请保持行李轻便。');

  const duplicate = await mockServer.call({
    action: 'activity.question.answer',
    data: {
      activityId: 'a_ride',
      questionId: asked.data.question.id,
      content: '第二个回答不应覆盖'
    },
    requestId: 'test:question:duplicate',
    idempotencyKey: 'test:question:duplicate-key'
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, 'CONFLICT');
});

test('Mock 问答同步执行内容安全且下架活动不泄露问答', async () => {
  mockServer.reset();
  mockServer.setPersona('u_member');
  const rejected = await call('activity.question.ask', {
    activityId: 'a_ride',
    content: '先付定金再告诉你'
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'CONTENT_REJECTED');

  const suspended = await call('activity.question.list', { activityId: 'a_suspended' });
  assert.equal(suspended.ok, false);
  assert.equal(suspended.error.code, 'TAKEDOWN');
  assert.equal(JSON.stringify(suspended).includes('测试问答'), false);
});
