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
