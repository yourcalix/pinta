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
    city: '上海',
    district: '杨浦区',
    placeLabel: '五角场',
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

function fakeCloud(rows, reads = []) {
  return {
    database() {
      return {
        command: { in: (values) => ({ $in: values }) },
        collection() {
          const query = {
            offset: 0,
            size: 20,
            where() { return this; },
            orderBy() { return this; },
            skip(value) { this.offset = value; return this; },
            limit(value) { this.size = value; return this; },
            async get() {
              reads.push({ offset: this.offset, size: this.size });
              return { data: rows.slice(this.offset, this.offset + this.size) };
            }
          };
          return query;
        }
      };
    }
  };
}

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
  assert.deepEqual(reads.at(-1), { offset: 450, size: 50 });
});
