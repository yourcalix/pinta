'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CloudStore } = require('../cloudfunctions/api/lib/cloud-store');
const { stableEntityId } = require('../cloudfunctions/api/lib/ids');
const { decodeDirectCursor } = require('../cloudfunctions/api/lib/direct-message');

// Store contract harness, not a replacement for real CloudBase index/transaction validation.
function cloudHarness(seed = {}) {
  const tables = new Map(Object.entries(seed).map(([name, rows]) => [name, new Map(rows.map((row) => [row._id, structuredClone(row)]))]));
  const table = (name, source = tables) => { if (!source.has(name)) source.set(name, new Map()); return source.get(name); };
  const matches = (row, where) => where.$or ? where.$or.some((part) => matches(row, part)) : Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object') return '$lt' in value ? row[key] < value.$lt : row[key] > value.$gt;
    return row[key] === value;
  });
  const doc = (name, id, source = tables) => ({
    get: async () => {
      const value = table(name, source).get(id);
      if (!value) throw { errCode: -502005 };
      return { data: structuredClone(value) };
    },
    set: async ({ data }) => { table(name, source).set(id, { ...structuredClone(data), _id: id }); },
    update: async ({ data }) => { Object.assign(table(name, source).get(id), structuredClone(data)); }
  });
  let queue = Promise.resolve();
  const db = {
    command: { lt: (value) => ({ $lt: value }), gt: (value) => ({ $gt: value }), or: (parts) => ({ $or: parts }) },
    collection(name) {
      let where = {};
      let limit = 100;
      const orders = [];
      const query = {
        doc: (id) => doc(name, id),
        where(value) { where = value; return query; },
        orderBy(key, direction) { orders.push([key, direction]); return query; },
        limit(value) { limit = value; return query; },
        async get() {
          const rows = [...table(name).values()].filter((row) => matches(row, where));
          rows.sort((a, b) => {
            for (const [key, dir] of orders) {
              const delta = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
              if (delta) return dir === 'desc' ? -delta : delta;
            }
            return 0;
          });
          return { data: structuredClone(rows.slice(0, limit)) };
        }
      };
      return query;
    },
    runTransaction(callback) {
      const operation = queue.then(async () => {
        const snapshot = structuredClone(tables);
        const result = await callback({ collection: (name) => ({ doc: (id) => doc(name, id, snapshot) }) });
        tables.clear();
        for (const [name, value] of snapshot) tables.set(name, value);
        return result;
      });
      queue = operation.catch(() => {});
      return operation;
    }
  };
  return { store: new CloudStore({ database: () => db }), tables, db };
}

test('Cloud 未读扫描覆盖每侧100条以上且不截断，会话双路同时间戳分页无漏重', async () => {
  const rows = Array.from({ length: 305 }, (_, i) => ({
    _id: `c${String(i).padStart(4, '0')}`, participantAId: i % 2 ? 'actor' : 'peer', participantBId: i % 2 ? 'peer' : 'actor',
    updatedAt: '2026-09-04T00:00:00.000Z', unreadByUser: { actor: 2 }
  }));
  const { store } = cloudHarness({ directConversations: rows });
  assert.deepEqual(await store.getDirectUnreadSummary('actor'), { totalUnread: 610, conversationsWithUnread: 305 });
  const ids = [];
  let cursor = null;
  do {
    const result = await store.listDirectConversations('actor', { cursor, limit: 20 });
    ids.push(...result.items.map((item) => item.id));
    cursor = decodeDirectCursor(result.nextCursor);
  } while (cursor);
  assert.equal(ids.length, 305);
  assert.equal(new Set(ids).size, 305);
});

function transactionFixture() {
  const conversation = { id: 'conversation', participantAId: 'a', participantBId: 'b', source: { id: 'activity' }, unreadByUser: { a: 0, b: 0 } };
  const harness = cloudHarness({
    users: [{ _id: 'a', status: 'ACTIVE' }, { _id: 'b', status: 'ACTIVE' }],
    activities: [{ _id: 'activity', status: 'FORMED' }],
    members: ['a', 'b'].map((id) => ({ _id: stableEntityId('member', 'activity', id), activityId: 'activity', userId: id, status: 'ACTIVE' }))
  });
  return { ...harness, conversation };
}

test('Cloud 事务双发送、幂等、条件已读保持消息/预览/未读一致', async () => {
  const { store, tables, conversation } = transactionFixture();
  await store.upsertDirectConversation(conversation);
  const send = (id) => store.addDirectMessage({ id, conversationId: 'conversation', senderId: 'a', text: id, payloadHash: id, createdAt: '2026-09-04T00:00:00.000Z' });
  await Promise.all([send('message-a'), send('message-b')]);
  await send('message-b');
  assert.equal(tables.get('directMessages').size, 2);
  assert.equal((await store.getDirectUnreadSummary('b')).totalUnread, 2);
  const stale = await store.markDirectConversationRead('conversation', 'b', 'message-a', 'now');
  assert.equal(stale.unreadByUser.b, 2);
  const latest = await store.markDirectConversationRead('conversation', 'b', 'message-b', 'now');
  assert.equal(latest.unreadByUser.b, 0);
});

test('Cloud 事务内成员退出或账号受限拒绝建会话和发信，失败无部分写入', async () => {
  const { store, tables, conversation } = transactionFixture();
  await store.upsertDirectConversation(conversation);
  tables.get('users').get('b').status = 'DISABLED';
  assert.equal(await store.isDirectMessagingAvailable(conversation), false);
  await assert.rejects(store.upsertDirectConversation({ ...conversation, id: 'other' }), { code: 'NOT_FOUND_OR_NOT_ALLOWED' });
  await assert.rejects(store.addDirectMessage({ id: 'denied', conversationId: 'conversation', senderId: 'a', text: '你好', payloadHash: 'x', createdAt: 'now' }), { code: 'CONFLICT' });
  assert.equal(tables.get('directMessages')?.size || 0, 0);
  assert.equal(tables.get('directConversations').get('conversation').unreadByUser.b, 0);
});

function groupFixture() {
  const activityId = 'group-activity';
  const users = ['owner', 'member'].map((id) => ({ _id: id, status: 'ACTIVE', profile: { nickname: id, gender: 'FEMALE', adultConfirmed: true } }));
  const members = users.map((user, index) => ({
    _id: stableEntityId('member', activityId, user._id), activityId, userId: user._id,
    role: index ? 'MEMBER' : 'OWNER', status: 'ACTIVE', avatarKind: 'PASSENGER_B',
    groupWindow: { generation: 1, after: 0 }
  }));
  return cloudHarness({ users, members, activities: [{ _id: activityId, title: '群聊活动', status: 'RECRUITING', groupSequence: 0 }] });
}

test('Cloud 群聊事务分配严格序号、分页和条件已读一致', async () => {
  const { store, tables } = groupFixture();
  const send = (clientMessageId, actorId, text = clientMessageId) => store.addGroupMessage({
    activityId: 'group-activity', actorId, generation: 1, clientMessageId, text,
    payloadHash: text, at: '2026-09-04T00:00:00.000Z'
  });
  const [first, second] = await Promise.all([send('cloud_msg_001', 'owner'), send('cloud_msg_002', 'member')]);
  assert.deepEqual([first.sequence, second.sequence].sort((a, b) => a - b), [1, 2]);
  assert.equal(tables.get('activityGroupMessages').size, 2);
  assert.equal(tables.get('activities').get('group-activity').groupSequence, 2);
  const page = await store.listGroupMessages('group-activity', 'member', { limit: 1, before: null });
  assert.equal(page.items.length, 1);
  assert.ok(page.nextBefore);
  const next = await store.listGroupMessages('group-activity', 'member', { limit: 1, before: page.nextBefore });
  assert.equal(next.items.length, 1);
  const latest = page.items[0];
  const read = await store.markGroupRead('group-activity', 'member', 1, latest.id, latest.sequence, 'now');
  assert.equal(read.sequence, latest.sequence);
  const stale = await store.markGroupRead('group-activity', 'member', 1, next.items[0].id, next.items[0].sequence, 'later');
  assert.equal(stale.sequence, latest.sequence);
});

test('Cloud 重入后旧周期历史、旧重试和旧已读状态全部不可见', async () => {
  const { store, tables } = groupFixture();
  const old = await store.addGroupMessage({ activityId: 'group-activity', actorId: 'member', generation: 1,
    clientMessageId: 'cloud_old_001', text: '旧消息', payloadHash: 'old', at: 'old' });
  await store.markGroupRead('group-activity', 'member', 1, old.id, old.sequence, 'old');
  const memberId = stableEntityId('member', 'group-activity', 'member');
  tables.get('members').get(memberId).groupWindow = { generation: 2, after: 1 };
  assert.deepEqual((await store.listGroupMessages('group-activity', 'member', { limit: 20, before: null })).items, []);
  await assert.rejects(store.getGroupMessageForReplay('group-activity', 'member', 1, 'cloud_old_001'), { code: 'CONFLICT' });
  const current = await store.addGroupMessage({ activityId: 'group-activity', actorId: 'member', generation: 2,
    clientMessageId: 'cloud_old_001', text: '新周期消息', payloadHash: 'new', at: 'new' });
  assert.notEqual(current.id, old.id);
  const thread = await store.getGroupThread('group-activity', 'member');
  assert.equal(thread.hasUnread, false, '自己的新消息不制造未读，旧周期已读也不参与当前周期');
});

test('Cloud 退出或下架后查询和幂等重放仍服务端拒绝', async () => {
  const { store, tables } = groupFixture();
  const data = { activityId: 'group-activity', actorId: 'member', generation: 1,
    clientMessageId: 'cloud_replay_001', text: '消息', payloadHash: 'hash', at: 'now' };
  await store.addGroupMessage(data);
  const memberId = stableEntityId('member', 'group-activity', 'member');
  tables.get('members').get(memberId).status = 'LEFT';
  await assert.rejects(store.getGroupMessageForReplay('group-activity', 'member', 1, data.clientMessageId), { code: 'FORBIDDEN' });
  await assert.rejects(store.listGroupMessages('group-activity', 'member', { limit: 20, before: null }), { code: 'FORBIDDEN' });
  tables.get('members').get(memberId).status = 'ACTIVE';
  tables.get('activities').get('group-activity').status = 'SUSPENDED';
  await assert.rejects(store.getGroupThread('group-activity', 'member'), { code: 'TAKEDOWN' });
});

test('Cloud 发起人咨询不要求共同成员，但不接受自定义目标且下架后历史重放拒绝', async () => {
  const harness = cloudHarness({
    users: [
      { _id: 'owner', status: 'ACTIVE', profile: { nickname: '发起人' } },
      { _id: 'visitor', status: 'ACTIVE', profile: { nickname: '访客' } }
    ],
    activities: [{ _id: 'consult-activity', ownerId: 'owner', title: '活动', type: 'sport', status: 'RECRUITING' }]
  });
  const relationship = await harness.store.resolveConsultationPeer('consult-activity', 'visitor');
  assert.equal(relationship.peerUserId, 'owner');
  const conversation = {
    id: 'consult-conversation', kind: 'OWNER_CONSULT', ownerId: 'owner', consultantId: 'visitor',
    participantAId: 'owner', participantBId: 'visitor', source: { id: 'consult-activity', type: 'activity_consult' },
    unreadByUser: { owner: 0, visitor: 0 }, updatedAt: 'now'
  };
  await harness.store.upsertDirectConversation(conversation);
  const message = { id: 'consult-message', conversationId: conversation.id, senderId: 'visitor',
    text: '请问活动安排？', payloadHash: 'hash', createdAt: 'now' };
  await harness.store.addDirectMessage(message);
  assert.equal((await harness.store.listDirectMessages(conversation.id, 'owner', { cursor: null, limit: 20 })).items.length, 1);
  harness.tables.get('activities').get('consult-activity').status = 'SUSPENDED';
  const unreadBeforeDeniedRead = harness.tables.get('directConversations').get(conversation.id).unreadByUser.owner;
  await assert.rejects(harness.store.markDirectConversationRead(conversation.id, 'owner', message.id, 'later'), { code: 'TAKEDOWN' });
  assert.equal(harness.tables.get('directConversations').get(conversation.id).unreadByUser.owner, unreadBeforeDeniedRead);
  assert.equal(harness.tables.get('directConversations').get(conversation.id).readAtByUser, undefined);
  await assert.rejects(harness.store.addDirectMessage(message), { code: 'TAKEDOWN' });
  await assert.rejects(harness.store.listDirectMessages(conversation.id, 'owner', { cursor: null, limit: 20 }), { code: 'TAKEDOWN' });
  assert.deepEqual((await harness.store.listDirectConversations('owner', { cursor: null, limit: 20 })).items, []);
});
