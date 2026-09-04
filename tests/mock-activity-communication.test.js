'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mock = require('../miniprogram/mocks/server');

async function invoke(action, data = {}, idempotencyKey = '') {
  const result = await mock.call({ action, data, ...(idempotencyKey ? { idempotencyKey } : {}) });
  assert.equal(result.ok, true, result.error && result.error.message);
  return result.data;
}

test('Mock 成员群聊仅向当前有效成员开放并使用成员周期', async () => {
  mock.reset();
  const thread = await invoke('group.thread', { activityId: 'a_buddy' });
  assert.equal(thread.generation, 1);
  assert.equal(thread.writable, true);
  const sent = await invoke('group.message.send', {
    activityId: 'a_buddy', generation: thread.generation,
    clientMessageId: 'mock_group_001', text: '周末体育馆见'
  }, 'mock-group-send-001');
  assert.equal(sent.message.sequence, 1);

  mock.setPersona('u_member');
  const page = await invoke('group.message.list', { activityId: 'a_buddy', limit: 20 });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].text, '周末体育馆见');
  assert.equal(page.items[0].isMine, false);
  await invoke('group.message.read', {
    activityId: 'a_buddy', generation: page.generation,
    messageId: page.items[0].id, sequence: page.items[0].sequence
  }, 'mock-group-read-001');
});

test('Mock 聊下固定创建与发起人的咨询且无需先加入活动', async () => {
  mock.reset();
  mock.setPersona('u_member');
  const created = await invoke('dm.consult.create', { activityId: 'a_product' }, 'mock-consult-create-001');
  assert.equal(created.conversation.kind, 'OWNER_CONSULT');
  assert.equal(created.conversation.peer.nickname, '邻里团长');
  assert.equal(created.conversation.messagingAvailable, true);
  const sent = await invoke('dm.message.send', {
    conversationId: created.conversation.id,
    clientMessageId: 'mock_consult_001', text: '请问集合地点确定了吗'
  }, 'mock-consult-send-001');
  assert.equal(sent.message.isMine, true);

  mock.setPersona('u_merchant');
  const page = await invoke('dm.message.list', { conversationId: created.conversation.id, limit: 20 });
  assert.equal(page.conversation.kind, 'OWNER_CONSULT');
  assert.equal(page.items[0].text, '请问集合地点确定了吗');
  assert.equal(page.items[0].isMine, false);

  mock.setPersona('u_admin');
  await invoke('admin.activity.suspend', { activityId: 'a_product', reason: '测试下架' }, 'mock-consult-suspend-001');
  mock.setPersona('u_merchant');
  const deniedRead = await mock.call({ action: 'dm.conversation.read', data: {
    conversationId: created.conversation.id, lastMessageId: page.items[0].id
  }, idempotencyKey: 'mock-consult-read-suspended-001' });
  assert.equal(deniedRead.ok, false);
  assert.equal(deniedRead.error.code, 'TAKEDOWN');
});
