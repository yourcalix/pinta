'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPinbaService } = require('../cloudfunctions/api/lib/service');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');
const { CloudStore } = require('../cloudfunctions/api/lib/cloud-store');
const {
  parsePublicCursor,
  collectPublicActivityPage
} = require('../cloudfunctions/api/lib/public-activity-page');

const NOW = '2026-08-24T08:00:00.000Z';

function activity(index, overrides = {}) {
  return {
    id: `activity-${String(index).padStart(2, '0')}`,
    ownerId: 'owner',
    owner: { nickname: '发起者' },
    type: 'buddy',
    title: index % 2 === 0 ? `命中活动 ${index}` : `普通活动 ${index}`,
    description: '分页测试',
    city: '澳门',
    district: '澳门校园',
    placeLabel: '青茂口岸 → 凼仔校区',
    startsAt: `2026-08-25T${String(index).padStart(2, '0')}:00:00.000Z`,
    deadlineAt: '2026-08-24T20:00:00.000Z',
    targetMembers: 3,
    memberCount: 1,
    status: 'RECRUITING',
    rules: '',
    typeData: { category: '运动', costMode: 'AA', level: 'BEGINNER', equipment: '' },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

test('公开列表游标只接受空值或非负十进制安全整数', () => {
  assert.equal(parsePublicCursor(undefined), 0);
  assert.equal(parsePublicCursor(''), 0);
  assert.equal(parsePublicCursor('12'), 12);
  [
    '-1',
    '1.5',
    '1e2',
    'abc',
    '9007199254740992',
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1
  ].forEach((cursor) => {
    assert.throws(
      () => parsePublicCursor(cursor),
      (error) => error.code === 'VALIDATION_ERROR' && /游标/.test(error.message)
    );
  });
});

test('raw-offset 扫描在稀疏关键词下填满页面并让下一页从额外命中项开始', async () => {
  const source = Array.from({ length: 12 }, (_, index) => activity(index));
  const first = await collectPublicActivityPage({
    offset: 0,
    limit: 3,
    keyword: '命中',
    at: NOW,
    fetchBatch: async (offset, size) => source.slice(offset, offset + size)
  });
  assert.deepEqual(first.items.map((item) => item.id), ['activity-00', 'activity-02', 'activity-04']);
  assert.equal(first.nextCursor, '6');

  const second = await collectPublicActivityPage({
    offset: parsePublicCursor(first.nextCursor),
    limit: 3,
    keyword: '命中',
    at: NOW,
    fetchBatch: async (offset, size) => source.slice(offset, offset + size)
  });
  assert.deepEqual(second.items.map((item) => item.id), ['activity-06', 'activity-08', 'activity-10']);
  assert.equal(second.nextCursor, null);
});

test('Memory 列表隐藏截止活动但不修改存储实体，详情统一返回 EXPIRED', async () => {
  const expired = activity(0, { deadlineAt: '2026-08-24T07:00:00.000Z' });
  const active = activity(1);
  const store = new MemoryStore({ activities: [expired, active] });
  const service = createPinbaService({ store, clock: () => new Date(NOW) });

  const page = await service.execute({ action: 'activity.list', data: { limit: 10 }, requestId: 'list' }, {});
  assert.deepEqual(page.data.items.map((item) => item.id), [active.id]);
  assert.equal(store.activities.get(expired.id).status, 'RECRUITING');

  const detail = await service.execute({
    action: 'activity.detail',
    data: { activityId: expired.id },
    requestId: 'detail'
  }, {});
  assert.equal(detail.ok, true);
  assert.equal(detail.data.activity.status, 'EXPIRED');

  const invalid = await service.execute({
    action: 'activity.list',
    data: { limit: 10, cursor: '1.5' },
    requestId: 'invalid-cursor'
  }, {});
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'VALIDATION_ERROR');
});

function matchesConditions(row, conditions) {
  return Object.entries(conditions || {}).every(([key, expected]) => {
    const actual = key.split('.').reduce((value, part) => value && value[part], row);
    return expected && Array.isArray(expected.$in)
      ? expected.$in.includes(actual)
      : actual === expected;
  });
}

function fakeCloud(rows, reads = []) {
  return {
    database() {
      return {
        command: { in: (values) => ({ $in: values }) },
        collection(name) {
          const collectionRows = name === 'rideFulfillments'
            ? rows.filter((row) => row.type === 'ride').map((row) => ({
                _id: `fulfillment-${row._id}`,
                activityId: row._id,
                status: 'UNASSIGNED',
                pickupAt: null
              }))
            : rows;
          const query = {
            offset: 0,
            size: 20,
            conditions: null,
            where(value) { this.conditions = value; return this; },
            orderBy() { return this; },
            skip(value) { this.offset = value; return this; },
            limit(value) { this.size = value; return this; },
            async get() {
              const filteredRows = collectionRows.filter((row) => matchesConditions(row, this.conditions));
              reads.push({ name, offset: this.offset, size: this.size, conditions: this.conditions });
              return { data: filteredRows.slice(this.offset, this.offset + this.size) };
            }
          };
          return query;
        }
      };
    }
  };
}

test('校区筛选在 Memory 与 Cloud 的分页候选层执行', async () => {
  const ride = (id, routeId, startsAt) => activity(0, {
    id,
    type: 'ride',
    title: `${routeId} 行程`,
    startsAt,
    targetMembers: 2,
    memberCount: 1,
    typeData: {
      routeId,
      pickupWindowEnd: '2026-08-25T12:00:00.000Z'
    }
  });
  const rows = [
    ride('taipa-in', 'QINGMAO_TO_TAIPA', '2026-08-25T09:00:00.000Z'),
    ride('taipa-out', 'TAIPA_TO_HENGQIN', '2026-08-25T10:00:00.000Z'),
    ride('dragon-in', 'QINGMAO_TO_GOLDEN_DRAGON', '2026-08-25T11:00:00.000Z')
  ];
  const memory = new MemoryStore({
    activities: rows,
    rideFulfillments: rows.map((item) => ({
      activityId: item.id,
      status: 'UNASSIGNED',
      pickupAt: null,
      driverId: null,
      vehicleId: null
    }))
  });
  const memoryPage = await memory.listActivities({ campusId: 'TAIPA_CAMPUS', limit: 10 }, NOW);
  assert.deepEqual(memoryPage.items.map((item) => item.id), ['taipa-in', 'taipa-out']);

  const reads = [];
  const cloudRows = rows.map(({ id, ...data }) => ({ _id: id, ...data }));
  const cloud = new CloudStore(fakeCloud(cloudRows, reads));
  const cloudPage = await cloud.listActivities({ campusId: 'TAIPA_CAMPUS', limit: 10 }, NOW);
  assert.deepEqual(cloudPage.items.map((item) => item.id), ['taipa-in', 'taipa-out']);
  assert.equal(reads[0].conditions.type, 'ride');
  assert.deepEqual([...reads[0].conditions['typeData.routeId'].$in].sort(), [
    'HENGQIN_TO_TAIPA',
    'QINGMAO_TO_TAIPA',
    'TAIPA_TO_HENGQIN',
    'TAIPA_TO_QINGMAO'
  ].sort());

  const incompatible = await cloud.listActivities({
    campusId: 'TAIPA_CAMPUS',
    routeId: 'QINGMAO_TO_GOLDEN_DRAGON',
    limit: 10
  }, NOW);
  assert.deepEqual(incompatible, { items: [], nextCursor: null });

  const nonRide = await cloud.listActivities({
    type: 'product',
    campusId: 'TAIPA_CAMPUS',
    limit: 10
  }, NOW);
  assert.deepEqual(nonRide, { items: [], nextCursor: null });
});

test('新活动列表忽略已废弃的校区筛选字段', async () => {
  const service = createPinbaService({
    store: new MemoryStore({ activities: [] }),
    clock: () => new Date(NOW)
  });
  const result = await service.execute({
    action: 'activity.list',
    data: { campusId: 'UNKNOWN_CAMPUS', limit: 10 },
    requestId: 'invalid-campus'
  }, {});
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.items, []);
});

test('Cloud Store 对 keyword 后过滤执行分批填页而不是先截断一页', async () => {
  const rows = Array.from({ length: 12 }, (_, index) => {
    const item = activity(index);
    const { id, ...data } = item;
    return { _id: id, ...data };
  });
  const store = new CloudStore(fakeCloud(rows));
  const page = await store.listActivities({ cursor: 0, limit: 3, keyword: '命中' }, NOW);
  assert.deepEqual(page.items.map((item) => item.id), ['activity-00', 'activity-02', 'activity-04']);
  assert.equal(page.nextCursor, '6');
});

test('Cloud Store 的稀疏命中可跨越多批查询且不会遗漏后续结果', async () => {
  const reads = [];
  const rows = Array.from({ length: 75 }, (_, index) => {
    const item = activity(index, {
      id: `sparse-${index}`,
      title: index === 60 ? '唯一稀疏命中' : `普通候选 ${index}`,
      startsAt: new Date(Date.parse(NOW) + index * 60 * 1000).toISOString()
    });
    const { id, ...data } = item;
    return { _id: id, ...data };
  });
  const store = new CloudStore(fakeCloud(rows, reads));
  const page = await store.listActivities({ cursor: 0, limit: 1, keyword: '唯一稀疏命中' }, NOW);
  assert.deepEqual(page.items.map((item) => item.id), ['sparse-60']);
  assert.equal(page.nextCursor, null);
  assert.ok(reads.length >= 4);
  assert.ok(reads.some((read) => read.offset >= 60));
});

test('Cloud Store 最多扫描 500 个原始候选并返回可继续游标', async () => {
  const reads = [];
  const rows = Array.from({ length: 600 }, (_, index) => {
    const item = activity(index, {
      id: `bounded-${index}`,
      title: `普通候选 ${index}`,
      startsAt: new Date(Date.parse(NOW) + index * 60 * 1000).toISOString()
    });
    const { id, ...data } = item;
    return { _id: id, ...data };
  });
  const store = new CloudStore(fakeCloud(rows, reads));
  const page = await store.listActivities({ cursor: 0, limit: 50, keyword: '不会命中' }, NOW);
  assert.deepEqual(page.items, []);
  assert.equal(page.nextCursor, '500');
  assert.equal(reads.length, 10);
  assert.equal(reads.at(-1).offset, 450);
  assert.equal(reads.at(-1).size, 50);
});

test.skip('旧拼车 fulfillment 迁移测试已由只读历史兼容层替代', async () => {
  const ride = (id, embeddedStatus) => {
    const source = activity(0, {
      id,
      type: 'ride',
      status: 'FORMED',
      memberCount: 2,
      targetMembers: 2,
      minPassengers: 2,
      maxPassengers: 4,
      startsAt: '2026-08-24T10:00:00.000Z',
      deadlineAt: '2026-08-24T09:00:00.000Z',
      rideJoinable: embeddedStatus === 'UNASSIGNED',
      rideFulfillment: { status: embeddedStatus },
      typeData: { routeId: 'QINGMAO_TO_TAIPA', pickupWindowEnd: '2026-08-24T11:00:00.000Z' }
    });
    const { id: activityId, ...data } = source;
    return { _id: activityId, ...data };
  };
  const activityRows = [ride('live-unassigned', 'ASSIGNED'), ride('live-assigned', 'UNASSIGNED')];
  const fulfillmentRows = [
    { _id: 'fulfillment-1', activityId: 'live-unassigned', status: 'UNASSIGNED' },
    { _id: 'fulfillment-2', activityId: 'live-assigned', status: 'ASSIGNED' }
  ];
  const cloud = {
    database() {
      return {
        command: { in: (values) => ({ $in: values }) },
        collection(name) {
          const rows = name === 'rideFulfillments' ? fulfillmentRows : activityRows;
          return {
            offset: 0,
            size: 20,
            where() { return this; },
            orderBy() { return this; },
            skip(value) { this.offset = value; return this; },
            limit(value) { this.size = value; return this; },
            async get() { return { data: rows.slice(this.offset, this.offset + this.size) }; }
          };
        }
      };
    }
  };
  const store = new CloudStore(cloud);
  const page = await store.listActivities({ type: 'ride', viewMode: 'driver', limit: 10 }, NOW);
  assert.deepEqual(page.items.map((item) => item.id), ['live-unassigned']);
});
