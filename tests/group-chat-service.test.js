'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPinbaService } = require('../cloudfunctions/api/lib/service');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');
const { beginGroupMembership } = require('../cloudfunctions/api/lib/group-chat-policy');

const profile = nickname => ({ nickname, gender: 'FEMALE', city: '澳门', interests: [], adultConfirmed: true });
function setup() {
  let tick = 0;
  const activity = { id: 'activity', ownerId: 'owner', type: 'sport', title: '周末羽毛球', status: 'RECRUITING', groupSequence: 0 };
  const store = new MemoryStore({
    users: ['owner', 'member', 'outsider'].map(id => ({ id, status: 'ACTIVE', role: 'user', profile: profile(id) })),
    activities: [activity],
    members: [
      { id: 'owner-member', activityId: 'activity', userId: 'owner', role: 'OWNER', status: 'ACTIVE', avatarKind: 'PASSENGER_B', groupWindow: { generation: 1, after: 0 } },
      { id: 'joined-member', activityId: 'activity', userId: 'member', role: 'MEMBER', status: 'ACTIVE', avatarKind: 'PASSENGER_B', groupWindow: { generation: 1, after: 0 } }
    ]
  });
  const service = createPinbaService({ store, clock: () => new Date(`2026-09-04T00:00:${String(tick++).padStart(2, '0')}.000Z`), idGenerator: () => `request-${tick}` });
  const call = (action, data, actorId, key) => service.execute({ action, data,
    requestId: `request-${tick}`, ...(key ? { idempotencyKey: key } : {}) }, { actorId });
  return { store, call };
}

test('真实群聊只允许当前成员，发送、分页和条件已读使用公开DTO', async () => {
  const { call } = setup();
  const outsider = await call('group.thread', { activityId: 'activity' }, 'outsider');
  assert.equal(outsider.error.code, 'FORBIDDEN');
  const thread = await call('group.thread', { activityId: 'activity' }, 'member');
  assert.deepEqual(thread.data, { activity: { id: 'activity', title: '周末羽毛球', status: 'RECRUITING' }, generation: 1, writable: true, hasUnread: false });
  const sent = await call('group.message.send', { activityId: 'activity', generation: 1,
    clientMessageId: 'client_msg_0001', text: '大家几点到？' }, 'owner', 'group-send-0001');
  assert.equal(sent.ok, true);
  assert.equal(sent.data.message.isMine, true);
  assert.equal(JSON.stringify(sent.data).includes('senderId'), false);
  assert.equal(JSON.stringify(sent.data).includes('memberId'), false);
  const listed = await call('group.message.list', { activityId: 'activity', limit: 20 }, 'member');
  assert.equal(listed.data.items[0].sender.nickname, 'owner');
  assert.equal(listed.data.items[0].isMine, false);
  const read = await call('group.message.read', { activityId: 'activity', generation: 1,
    messageId: listed.data.items[0].id, sequence: listed.data.items[0].sequence }, 'member', 'group-read-0001');
  assert.equal(read.ok, true);
  assert.equal((await call('group.thread', { activityId: 'activity' }, 'member')).data.hasUnread, false);
});

test('群消息重试不重复审核限流，同ID不同正文冲突，旧周期重试不能泄漏', async () => {
  let checks = 0;
  const { store, call } = setup();
  const moderated = createPinbaService({ store, moderation: { async check() { checks += 1; } },
    clock: () => new Date('2026-09-04T00:00:00.000Z'), idGenerator: () => 'request' });
  const send = (data, key) => moderated.execute({ action: 'group.message.send', data, idempotencyKey: key }, { actorId: 'member' });
  const data = { activityId: 'activity', generation: 1, clientMessageId: 'client_msg_retry', text: '收到' };
  const first = await send(data, 'group-retry-001');
  const replay = await send(data, 'group-retry-002');
  assert.equal(first.data.message.id, replay.data.message.id);
  assert.equal(checks, 1);
  assert.equal((await send({ ...data, text: '改了正文' }, 'group-retry-003')).error.code, 'CONFLICT');

  const member = store.members.get('joined-member');
  member.status = 'LEFT';
  assert.equal((await send(data, 'group-retry-004')).error.code, 'FORBIDDEN');
  member.status = 'ACTIVE';
  member.groupWindow = beginGroupMembership(store.activities.get('activity'), member.groupWindow);
  assert.equal((await send(data, 'group-retry-005')).error.code, 'CONFLICT');
  const afterRejoin = await send({ ...data, generation: 2 }, 'group-retry-006');
  assert.equal(afterRejoin.ok, true);
  assert.notEqual(afterRejoin.data.message.id, first.data.message.id);
  const history = await call('group.message.list', { activityId: 'activity' }, 'member');
  assert.deepEqual(history.data.items.map(item => item.id), [afterRejoin.data.message.id]);
});

test('终态当前成员只读，下架禁读，旧已读状态不能跨重新加入周期', async () => {
  const { store, call } = setup();
  const sent = await call('group.message.send', { activityId: 'activity', generation: 1,
    clientMessageId: 'client_msg_state', text: '旧周期消息' }, 'owner', 'group-state-001');
  await call('group.message.read', { activityId: 'activity', generation: 1,
    messageId: sent.data.message.id, sequence: sent.data.message.sequence }, 'member', 'group-state-002');
  store.activities.get('activity').status = 'COMPLETED';
  assert.equal((await call('group.message.list', { activityId: 'activity' }, 'member')).ok, true);
  assert.equal((await call('group.message.send', { activityId: 'activity', generation: 1,
    clientMessageId: 'client_msg_state2', text: '不能发送' }, 'member', 'group-state-003')).error.code, 'CONFLICT');
  store.activities.get('activity').status = 'SUSPENDED';
  assert.equal((await call('group.message.list', { activityId: 'activity' }, 'member')).error.code, 'TAKEDOWN');
});

test('新建活动及批准成员在加入事务内记录群历史边界', async () => {
  const { store } = setup();
  const activity = { id: 'new-activity', ownerId: 'owner', type: 'sport', title: '新活动', status: 'RECRUITING', operationKeyHash: 'operation' };
  const owner = { id: 'new-owner-member', activityId: activity.id, userId: 'owner', role: 'OWNER', status: 'ACTIVE', avatarKind: 'PASSENGER_B' };
  await store.createActivityWithOwner(activity, owner);
  assert.equal(store.activities.get(activity.id).groupSequence, 0);
  assert.deepEqual(store.members.get(owner.id).groupWindow, { generation: 1, after: 0 });
  store.activities.get(activity.id).groupSequence = 7;
  store.activities.get(activity.id).memberCount = 1;
  store.activities.get(activity.id).minMembers = 2;
  store.activities.get(activity.id).maxMembers = 4;
  store.activities.get(activity.id).deadlineAt = '2026-09-05T00:00:00.000Z';
  store.applications.set('application', { id: 'application', activityId: activity.id, applicantId: 'member', status: 'PENDING' });
  const result = await store.approveApplicationAtomic({ activityId: activity.id, applicationId: 'application', ownerId: 'owner', at: '2026-09-04T01:00:00.000Z' });
  assert.deepEqual(result.member.groupWindow, { generation: 1, after: 7 });
  result.member.status = 'LEFT';
  store.members.set(result.member.id, result.member);
  result.application.status = 'PENDING';
  store.applications.set(result.application.id, result.application);
  store.activities.get(activity.id).status = 'RECRUITING';
  store.activities.get(activity.id).memberCount = 1;
  store.activities.get(activity.id).groupSequence = 9;
  const rejoined = await store.approveApplicationAtomic({ activityId: activity.id, applicationId: 'application', ownerId: 'owner', at: '2026-09-04T02:00:00.000Z' });
  assert.deepEqual(rejoined.member.groupWindow, { generation: 2, after: 9 });
});
