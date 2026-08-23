'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mockServer = require('../miniprogram/mocks/server');

async function call(action, data = {}) {
  return mockServer.call({ action, data, requestId: `test:${action}`, idempotencyKey: `test:${action}:12345678` });
}

test('Mock 模式可以完成审批、自动成团和成员联系信息解锁', async () => {
  mockServer.reset();
  mockServer.setPersona('u_owner');
  const applications = await call('application.listForOwner', { activityId: 'a_ride' });
  assert.equal(applications.ok, true);
  assert.equal(applications.data.items[0].status, 'PENDING');

  const approved = await call('application.approve', {
    activityId: 'a_ride',
    applicationId: applications.data.items[0].id
  });
  assert.equal(approved.ok, true);
  assert.equal(approved.data.activity.status, 'FORMED');

  mockServer.setPersona('u_member');
  const contact = await call('group.contact', { activityId: 'a_ride' });
  assert.equal(contact.ok, true);
  assert.match(contact.data.contactInfo, /pinba_xiaopin/);
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
