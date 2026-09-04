'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPinbaService } = require('../cloudfunctions/api/lib/service');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');

function user(id, nickname) {
  return {
    id,
    role: 'user',
    status: 'ACTIVE',
    profile: { nickname, gender: 'MALE', city: '澳门', interests: [], adultConfirmed: true }
  };
}

function setup(options = {}) {
  let now = new Date('2026-09-02T07:00:00.000Z');
  let request = 0;
  const activity = { id: 'activity-formed', ownerId: 'owner', type: 'sport', title: '周末羽毛球', status: 'FORMED' };
  const store = new MemoryStore({
    users: [user('owner', '发起人'), user('member', '搭子'), user('outsider', '路人')],
    activities: [activity],
    members: [
      { id: 'member-owner', activityId: activity.id, userId: 'owner', role: 'OWNER', status: 'ACTIVE' },
      { id: 'member-peer', activityId: activity.id, userId: 'member', role: 'MEMBER', status: 'ACTIVE' }
    ]
  });
  const service = createPinbaService({ ...options, store, clock: () => new Date(now), idGenerator: () => `generated-${++request}` });
  const call = (action, data = {}, actorId = null, key) => service.execute({
    action,
    data,
    requestId: `dm-${++request}`,
    ...(key ? { idempotencyKey: key } : {})
  }, actorId ? { actorId } : {});
  return {
    store,
    call,
    advance(milliseconds = 1000) { now = new Date(now.getTime() + milliseconds); }
  };
}

test('没有私信会话时列表成功返回空数组而不是错误态', async () => {
  const { call } = setup();
  const result = await call('dm.conversation.list', {}, 'owner');
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.items, []);
  assert.equal(result.data.nextCursor, null);
});

test('私信来源活动类型经过白名单与历史类型归一化', async () => {
  const { call, store } = setup();
  store.activities.get('activity-formed').type = 'buddy';
  const created = await call('dm.conversation.create', {
    activityId: 'activity-formed', memberId: 'member-peer'
  }, 'owner', 'dm-create-legacy-type');
  assert.equal(created.ok, true);
  assert.equal(created.data.conversation.source.activityType, 'sport');
});

test('私信会话只能通过已成团活动的有效成员关系创建', async () => {
  const { call, store } = setup();
  const created = await call('dm.conversation.create', {
    activityId: 'activity-formed', memberId: 'member-peer'
  }, 'owner', 'dm-create-001');
  assert.equal(created.ok, true);
  assert.equal(created.data.conversation.peer.nickname, '搭子');
  assert.equal(created.data.conversation.source.title, '周末羽毛球');
  assert.equal(created.data.conversation.source.activityType, 'sport');
  assert.equal(JSON.stringify(created.data).includes('member'), false, '公开 DTO 不应暴露对方用户 ID');

  const outsider = await call('dm.conversation.create', {
    activityId: 'activity-formed', memberId: 'member-peer'
  }, 'outsider', 'dm-create-002');
  assert.equal(outsider.error.code, 'NOT_FOUND_OR_NOT_ALLOWED');

  const nakedTarget = await call('dm.conversation.create', {
    activityId: 'activity-formed', targetUserId: 'member'
  }, 'owner', 'dm-create-003');
  assert.equal(nakedTarget.error.code, 'VALIDATION_ERROR');

  const self = await call('dm.conversation.create', {
    activityId: 'activity-formed', memberId: 'member-owner'
  }, 'owner', 'dm-create-004');
  assert.equal(self.error.code, 'NOT_FOUND_OR_NOT_ALLOWED');

  store.activities.set('activity-second', { id: 'activity-second', ownerId: 'owner', title: '另一场活动', status: 'FORMED' });
  store.members.set('second-owner', { id: 'second-owner', activityId: 'activity-second', userId: 'owner', role: 'OWNER', status: 'ACTIVE' });
  store.members.set('second-peer', { id: 'second-peer', activityId: 'activity-second', userId: 'member', role: 'MEMBER', status: 'ACTIVE' });
  const secondActivity = await call('dm.conversation.create', {
    activityId: 'activity-second', memberId: 'second-peer'
  }, 'owner', 'dm-create-005');
  assert.equal(secondActivity.ok, true);
  assert.notEqual(secondActivity.data.conversation.id, created.data.conversation.id);
});

test('私信发送绑定登录者、阻断联系方式并对客户端消息 ID 幂等', async () => {
  const { call, store } = setup();
  const opened = await call('dm.conversation.create', {
    activityId: 'activity-formed', memberId: 'member-peer'
  }, 'owner', 'dm-create-010');
  const conversationId = opened.data.conversation.id;

  const first = await call('dm.message.send', {
    conversationId, clientMessageId: 'client_message_001', text: '你好，周末见', senderId: 'member'
  }, 'owner', 'dm-send-001');
  assert.equal(first.ok, true);
  assert.equal(first.data.message.isMine, true);
  assert.equal(store.directMessages.get(first.data.message.id).senderId, 'owner');

  const replay = await call('dm.message.send', {
    conversationId, clientMessageId: 'client_message_001', text: '你好，周末见', senderId: 'member'
  }, 'owner', 'dm-send-002');
  assert.equal(replay.ok, true);
  assert.equal(store.directMessages.size, 1);

  const conflict = await call('dm.message.send', {
    conversationId, clientMessageId: 'client_message_001', text: '另一条不同的消息'
  }, 'owner', 'dm-send-003');
  assert.equal(conflict.error.code, 'CONFLICT');

  const unsafe = await call('dm.message.send', {
    conversationId, clientMessageId: 'client_message_002', text: '加我微信 pinba12345'
  }, 'owner', 'dm-send-004');
  assert.equal(unsafe.error.code, 'VALIDATION_ERROR');

  const outsider = await call('dm.message.send', {
    conversationId, clientMessageId: 'client_message_003', text: '越权消息'
  }, 'outsider', 'dm-send-005');
  assert.equal(outsider.error.code, 'NOT_FOUND_OR_NOT_ALLOWED');
});

test('同一发送者在不同活动会话复用 clientMessageId 不会串消息', async () => {
  const { call, store } = setup();
  const first = await call('dm.conversation.create', {
    activityId: 'activity-formed', memberId: 'member-peer'
  }, 'owner', 'dm-create-015a');
  store.activities.set('activity-second', { id: 'activity-second', ownerId: 'owner', title: '另一场活动', status: 'FORMED' });
  store.members.set('second-owner', { id: 'second-owner', activityId: 'activity-second', userId: 'owner', role: 'OWNER', status: 'ACTIVE' });
  store.members.set('second-peer', { id: 'second-peer', activityId: 'activity-second', userId: 'member', role: 'MEMBER', status: 'ACTIVE' });
  const second = await call('dm.conversation.create', {
    activityId: 'activity-second', memberId: 'second-peer'
  }, 'owner', 'dm-create-015b');

  const firstMessage = await call('dm.message.send', {
    conversationId: first.data.conversation.id, clientMessageId: 'client_shared_015', text: '同一正文'
  }, 'owner', 'dm-send-015a');
  const secondMessage = await call('dm.message.send', {
    conversationId: second.data.conversation.id, clientMessageId: 'client_shared_015', text: '同一正文'
  }, 'owner', 'dm-send-015b');
  assert.equal(firstMessage.ok, true);
  assert.equal(secondMessage.ok, true);
  assert.notEqual(firstMessage.data.message.id, secondMessage.data.message.id);
  assert.equal(store.directMessages.size, 2);
});

test('已入库消息重试跳过限流审核，关闭后只重放旧结果，停用发送者仍拒绝', async () => {
  let rejectModeration = false;
  const { call, store } = setup({ moderation: { async check() { if (rejectModeration) throw new Error('should not moderate a replay'); } } });
  const opened = await call('dm.conversation.create', { activityId: 'activity-formed', memberId: 'member-peer' }, 'owner', 'replay-create');
  const conversationId = opened.data.conversation.id;
  const data = { conversationId, clientMessageId: 'replay-known-message', text: '已经发送的消息' };
  const first = await call('dm.message.send', data, 'owner', 'replay-first');
  assert.equal(first.ok, true);
  rejectModeration = true;
  store.consumeCommunityRateLimit = async () => { throw new Error('should not consume replay quota'); };
  const replay = await call('dm.message.send', data, 'owner', 'replay-second');
  assert.equal(replay.ok, true);
  assert.equal(replay.data.message.id, first.data.message.id);
  store.activities.get('activity-formed').status = 'COMPLETED';
  assert.equal((await call('dm.message.send', data, 'owner', 'replay-closed')).ok, true);
  const conflict = await call('dm.message.send', { ...data, text: '改了正文' }, 'owner', 'replay-conflict');
  assert.equal(conflict.error.code, 'CONFLICT');
  assert.equal(store.directMessages.size, 1);
  assert.equal((await call('dm.unread', {}, 'member')).data.totalUnread, 1);
  store.users.get('owner').status = 'DISABLED';
  assert.equal((await call('dm.message.send', data, 'owner', 'replay-disabled')).error.code, 'ACCOUNT_DISABLED');
});

test('未读数只为收件人增加，打开具体会话后才清零', async () => {
  const { call } = setup();
  const opened = await call('dm.conversation.create', {
    activityId: 'activity-formed', memberId: 'member-peer'
  }, 'owner', 'dm-create-020');
  const conversationId = opened.data.conversation.id;
  await call('dm.message.send', {
    conversationId, clientMessageId: 'client_message_020', text: '周末见'
  }, 'owner', 'dm-send-020');

  assert.equal((await call('dm.unread', {}, 'owner')).data.totalUnread, 0);
  assert.equal((await call('dm.unread', {}, 'member')).data.totalUnread, 1);
  assert.equal((await call('dm.conversation.list', {}, 'member')).data.items[0].unreadCount, 1);

  const listed = await call('dm.message.list', { conversationId }, 'member');
  const marked = await call('dm.conversation.read', {
    conversationId,
    lastMessageId: listed.data.conversation.lastMessage.id
  }, 'member', 'dm-read-020');
  assert.equal(marked.ok, true);
  assert.equal((await call('dm.unread', {}, 'member')).data.totalUnread, 0);
});

test('已读条件不会清掉列表返回后才到达的新消息', async () => {
  const { call, advance } = setup();
  const opened = await call('dm.conversation.create', {
    activityId: 'activity-formed', memberId: 'member-peer'
  }, 'owner', 'dm-create-025');
  const conversationId = opened.data.conversation.id;
  await call('dm.message.send', {
    conversationId, clientMessageId: 'client_message_025a', text: '第一条'
  }, 'owner', 'dm-send-025a');
  const firstView = await call('dm.message.list', { conversationId }, 'member');
  advance();
  await call('dm.message.send', {
    conversationId, clientMessageId: 'client_message_025b', text: '列表后到达的新消息'
  }, 'owner', 'dm-send-025b');
  const conditionalRead = await call('dm.conversation.read', {
    conversationId,
    lastMessageId: firstView.data.conversation.lastMessage.id
  }, 'member', 'dm-read-025a');
  assert.equal(conditionalRead.data.unread, 2);

  const latestView = await call('dm.message.list', { conversationId }, 'member');
  const appliedRead = await call('dm.conversation.read', {
    conversationId,
    lastMessageId: latestView.data.conversation.lastMessage.id
  }, 'member', 'dm-read-025b');
  assert.equal(appliedRead.data.unread, 0);
});

test('私信历史使用稳定复合游标分页', async () => {
  const { call, advance } = setup();
  const opened = await call('dm.conversation.create', {
    activityId: 'activity-formed', memberId: 'member-peer'
  }, 'owner', 'dm-create-030');
  const conversationId = opened.data.conversation.id;
  for (let index = 0; index < 3; index += 1) {
    advance();
    const sent = await call('dm.message.send', {
      conversationId, clientMessageId: `client_message_03${index}`, text: `消息 ${index}`
    }, index % 2 ? 'member' : 'owner', `dm-send-03${index}`);
    assert.equal(sent.ok, true);
  }
  const first = await call('dm.message.list', { conversationId, limit: 2 }, 'owner');
  assert.deepEqual(first.data.items.map((item) => item.text), ['消息 2', '消息 1']);
  assert.ok(first.data.nextCursor);
  const second = await call('dm.message.list', { conversationId, limit: 2, cursor: first.data.nextCursor }, 'owner');
  assert.deepEqual(second.data.items.map((item) => item.text), ['消息 0']);
});

test('共同活动结束后保留历史会话但禁止继续发送', async () => {
  const { call, store } = setup();
  const opened = await call('dm.conversation.create', {
    activityId: 'activity-formed', memberId: 'member-peer'
  }, 'owner', 'dm-create-035');
  const conversationId = opened.data.conversation.id;
  store.activities.get('activity-formed').status = 'COMPLETED';

  const history = await call('dm.message.list', { conversationId }, 'owner');
  assert.equal(history.ok, true);
  assert.equal(history.data.conversation.messagingAvailable, false);
  const sent = await call('dm.message.send', {
    conversationId, clientMessageId: 'client_message_035', text: '活动后继续联系'
  }, 'owner', 'dm-send-035');
  assert.equal(sent.error.code, 'CONFLICT');
});

test('成员退出后即使活动仍为成团也不能继续发私信', async () => {
  const { call, store } = setup();
  const opened = await call('dm.conversation.create', {
    activityId: 'activity-formed', memberId: 'member-peer'
  }, 'owner', 'dm-create-036');
  store.members.get('member-peer').status = 'LEFT';
  const history = await call('dm.message.list', { conversationId: opened.data.conversation.id }, 'owner');
  assert.equal(history.ok, true);
  assert.equal(history.data.conversation.messagingAvailable, false);
  const sent = await call('dm.message.send', {
    conversationId: opened.data.conversation.id,
    clientMessageId: 'client_message_036',
    text: '退出后联系'
  }, 'owner', 'dm-send-036');
  assert.equal(sent.error.code, 'CONFLICT');
});

test('对方账号受限后历史保留但不得发送新消息', async () => {
  const { call, store } = setup();
  const opened = await call('dm.conversation.create', { activityId: 'activity-formed', memberId: 'member-peer' }, 'owner', 'disabled-peer-create');
  const conversationId = opened.data.conversation.id;
  store.users.get('member').status = 'DISABLED';
  const history = await call('dm.message.list', { conversationId }, 'owner');
  assert.equal(history.data.conversation.messagingAvailable, false);
  const sent = await call('dm.message.send', { conversationId, clientMessageId: 'disabled-peer-message', text: '新的消息' }, 'owner', 'disabled-peer-send');
  assert.equal(sent.ok, false);
  assert.equal(store.directMessages.size, 0);
});

test('未参与者不能标记已读，活动关闭仍能读取与举报历史', async () => {
  const { call, store } = setup();
  const opened = await call('dm.conversation.create', { activityId: 'activity-formed', memberId: 'member-peer' }, 'owner', 'closed-read-create');
  const conversationId = opened.data.conversation.id;
  const sent = await call('dm.message.send', { conversationId, clientMessageId: 'closed-read-message', text: '你好' }, 'owner', 'closed-read-send');
  const denied = await call('dm.conversation.read', { conversationId, lastMessageId: sent.data.message.id }, 'outsider', 'outsider-read-key');
  assert.equal(denied.error.code, 'NOT_FOUND_OR_NOT_ALLOWED');
  store.activities.get('activity-formed').status = 'CANCELLED';
  assert.equal((await call('dm.message.list', { conversationId }, 'member')).ok, true);
  assert.equal((await call('report.create', { targetType: 'directConversation', targetId: conversationId, reason: 'HARASSMENT' }, 'member', 'closed-report-key')).ok, true);
});

test('会话可进入统一举报契约，Cloud 写入使用事务', async () => {
  const { call } = setup();
  const opened = await call('dm.conversation.create', {
    activityId: 'activity-formed', memberId: 'member-peer'
  }, 'owner', 'dm-create-040');
  const reported = await call('report.create', {
    targetType: 'directConversation', targetId: opened.data.conversation.id, reason: 'HARASSMENT', description: ''
  }, 'owner', 'dm-report-040');
  assert.equal(reported.ok, true);
  const outsiderReport = await call('report.create', {
    targetType: 'directConversation', targetId: opened.data.conversation.id, reason: 'HARASSMENT', description: ''
  }, 'outsider', 'dm-report-041');
  assert.equal(outsiderReport.error.code, 'NOT_FOUND_OR_NOT_ALLOWED');

  const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/api/lib/cloud-store.js'), 'utf8');
  const section = source.slice(source.indexOf('async addDirectMessage'), source.indexOf('async getDirectUnreadSummary'));
  assert.match(section, /runTransaction/);
  assert.match(section, /participantAId/);
  assert.match(section, /participantBId/);
});
