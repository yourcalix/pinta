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
