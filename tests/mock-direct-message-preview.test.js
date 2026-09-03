'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const mockServer = require('../miniprogram/mocks/server');

test('Mock 默认数据提供可从消息中心直接打开的私信会话', async () => {
  mockServer.reset();
  mockServer.setPersona('u_owner');

  const conversations = await mockServer.call({
    action: 'dm.conversation.list',
    data: { limit: 20 },
    requestId: 'mock-preview-list'
  });

  assert.equal(conversations.ok, true);
  assert.equal(conversations.data.items.length, 1);
  assert.equal(conversations.data.items[0].peer.nickname, '阿同');
  assert.equal(conversations.data.items[0].source.id, 'a_buddy');
  assert.equal(conversations.data.items[0].source.activityType, 'sport');
  assert.equal(conversations.data.items[0].messagingAvailable, true);

  const messages = await mockServer.call({
    action: 'dm.message.list',
    data: { conversationId: conversations.data.items[0].id, limit: 20 },
    requestId: 'mock-preview-messages'
  });

  assert.equal(messages.ok, true);
  assert.ok(messages.data.items.length >= 4);
  assert.ok(messages.data.items.some((item) => item.isMine));
  assert.ok(messages.data.items.some((item) => !item.isMine));
});

test.after(() => {
  mockServer.reset();
});
