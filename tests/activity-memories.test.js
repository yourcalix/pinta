'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPinbaService } = require('../cloudfunctions/api/lib/service');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');
const { CloudStore } = require('../cloudfunctions/api/lib/cloud-store');
const { validateActivityMemoriesInput } = require('../cloudfunctions/api/lib/validation');

const NOW = '2026-09-06T08:00:00.000Z';

function activity(id, status, formedAt, overrides = {}) {
  return {
    id,
    ownerId: 'owner',
    owner: { nickname: '发起者' },
    type: 'buddy',
    title: `活动 ${id}`,
    description: '公开说明',
    city: '澳门',
    district: '澳门校园',
    placeLabel: '附近体育馆',
    startsAt: '2026-09-05T10:00:00.000Z',
    deadlineAt: '2026-09-05T09:00:00.000Z',
    targetMembers: 4,
    minMembers: 2,
    maxMembers: 4,
    memberCount: status === 'FORMED' ? 4 : 1,
    status,
    rules: '',
    typeData: { category: '羽毛球', venue: '附近体育馆' },
    formedAt,
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: formedAt || '2026-09-01T08:00:00.000Z',
    contactInfo: { wechat: 'private' },
    ...overrides
  };
}

test('成团记忆入参只允许 1—6 条并拒绝客户端状态筛选', () => {
  assert.deepEqual(validateActivityMemoriesInput({ limit: 3 }), { limit: 3 });
  assert.equal(validateActivityMemoriesInput({}).limit, 6);
  assert.throws(() => validateActivityMemoriesInput({ limit: 7 }), (error) => error.code === 'VALIDATION_ERROR');
  assert.throws(
    () => validateActivityMemoriesInput({ limit: 3, status: 'RECRUITING' }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});

test('activity.memories 仅返回最近 FORMED 活动且继续使用公开 DTO', async () => {
  const store = new MemoryStore({
    activities: [
      activity('recruiting', 'RECRUITING', null),
      activity('legacy-without-time', 'FORMED', null),
      activity('older', 'FORMED', '2026-09-02T08:00:00.000Z'),
      activity('newest', 'FORMED', '2026-09-05T08:00:00.000Z'),
      activity('middle', 'FORMED', '2026-09-04T08:00:00.000Z')
    ]
  });
  const service = createPinbaService({ store, clock: () => new Date(NOW) });
  const response = await service.execute({
    action: 'activity.memories',
    data: { limit: 2 },
    requestId: 'memories'
  }, {});

  assert.equal(response.ok, true);
  assert.deepEqual(response.data.items.map((item) => item.id), ['newest', 'middle']);
  assert.ok(response.data.items.every((item) => item.status === 'FORMED'));
  assert.equal('ownerId' in response.data.items[0], false);
  assert.equal('contactInfo' in response.data.items[0], false);
  assert.equal(response.data.items[0].formedAt, '2026-09-05T08:00:00.000Z');
});

test('activity.memories 是免登录公开只读动作', async () => {
  const service = createPinbaService({
    store: new MemoryStore({ activities: [activity('formed', 'FORMED', NOW)] }),
    clock: () => new Date(NOW)
  });
  const response = await service.execute({ action: 'activity.memories', data: {}, requestId: 'public' }, {});
  assert.equal(response.ok, true);
  assert.equal(response.data.items.length, 1);
});

test('activity.memories 在服务入口拒绝客户端注入 status', async () => {
  const service = createPinbaService({ store: new MemoryStore({ activities: [] }), clock: () => new Date(NOW) });
  const response = await service.execute({
    action: 'activity.memories',
    data: { status: 'RECRUITING' },
    requestId: 'invalid-status'
  }, {});
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'VALIDATION_ERROR');
});

test('Cloud 成团记忆直接按 formedAt 倒序限量查询', async () => {
  const queryFacts = {};
  const rows = [
    { _id: 'newest', status: 'FORMED', formedAt: '2026-09-05T08:00:00.000Z' },
    { _id: 'older', status: 'FORMED', formedAt: '2026-09-02T08:00:00.000Z' }
  ];
  const cloud = {
    database() {
      return {
        command: {},
        collection() {
          return {
            where(value) { queryFacts.where = value; return this; },
            orderBy(field, direction) { queryFacts.orderBy = [field, direction]; return this; },
            limit(value) { queryFacts.limit = value; return this; },
            async get() { return { data: rows }; }
          };
        }
      };
    }
  };
  const store = new CloudStore(cloud);
  const result = await store.listActivityMemories(2);
  assert.deepEqual(queryFacts.where, { status: 'FORMED' });
  assert.deepEqual(queryFacts.orderBy, ['formedAt', 'desc']);
  assert.equal(queryFacts.limit, 24);
  assert.deepEqual(result.map((item) => item.id), ['newest', 'older']);
});
