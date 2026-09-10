'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateActivityInput, validateActivityNearbyInput } = require('../cloudfunctions/api/lib/validation');
const { haversineDistanceMeters, encodeNearbyCursor, decodeNearbyCursor } = require('../cloudfunctions/api/lib/activity-location');
const { createPinbaService } = require('../cloudfunctions/api/lib/service');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');
const { CloudStore } = require('../cloudfunctions/api/lib/cloud-store');
const mockServer = require('../miniprogram/mocks/server');

const NOW = new Date('2026-09-10T02:00:00.000Z');
const ORIGIN = { latitude: 22.198745, longitude: 113.543873 };

function activity(id, latitude, longitude, overrides = {}) {
  return {
    id, ownerId: 'owner', owner: { nickname: '发起人' }, type: 'sport', title: `活动${id}`,
    description: '', city: '澳门', district: '澳门校园', placeLabel: '公共场馆',
    startsAt: '2026-09-11T04:00:00.000Z', deadlineAt: '2026-09-10T10:00:00.000Z',
    minMembers: 2, maxMembers: 4, targetMembers: 4, memberCount: 1, status: 'RECRUITING', rules: '',
    typeData: { sportType: '羽毛球', venue: '公共场馆', level: 'ANY', intensity: 'LIGHT', equipment: '' },
    meetingPoint: { label: '公共场馆', address: '澳门公共场馆', latitude, longitude, coordinateSystem: 'GCJ02', provider: 'AMAP', poiId: id },
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), ...overrides
  };
}

test('发布会合地点严格接受高德 GCJ-02 结构化 POI，并兼容历史无坐标活动', () => {
  const payload = {
    ...activity('draft', ORIGIN.latitude, ORIGIN.longitude),
    deadlineAt: '2026-09-10T10:00:00.000Z', startsAt: '2026-09-11T04:00:00.000Z'
  };
  const validated = validateActivityInput(payload, NOW);
  assert.equal(validated.meetingPoint.provider, 'AMAP');
  assert.equal(validated.meetingPoint.coordinateSystem, 'GCJ02');
  assert.equal(validateActivityInput({ ...payload, meetingPoint: undefined }, NOW).meetingPoint, undefined);
  assert.throws(() => validateActivityInput({ ...payload, meetingPoint: { ...payload.meetingPoint, coordinateSystem: 'WGS84' } }, NOW), /坐标系/);
  assert.throws(() => validateActivityInput({ ...payload, meetingPoint: { ...payload.meetingPoint, latitude: 80 } }, NOW), /试点区域/);
});

test('附近查询绑定澳门、半径、坐标系和不可跨条件复用的游标', () => {
  const first = validateActivityNearbyInput({ ...ORIGIN, coordinateSystem: 'GCJ02', radiusMeters: 3000, type: 'sport', limit: 10 });
  assert.equal(first.radiusMeters, 3000);
  assert.equal(first.after, null);
  assert.throws(() => validateActivityNearbyInput({ ...ORIGIN, coordinateSystem: 'WGS84', radiusMeters: 3000 }), /坐标系/);
  assert.throws(() => validateActivityNearbyInput({ ...ORIGIN, coordinateSystem: 'GCJ02', radiusMeters: 20000 }), /搜索半径/);
});

test('Haversine 使用米制距离并保持对称', () => {
  const next = { latitude: 22.199745, longitude: 113.543873 };
  const forward = haversineDistanceMeters(ORIGIN, next);
  assert.ok(forward > 100 && forward < 120);
  assert.equal(forward, haversineDistanceMeters(next, ORIGIN));
});

test('附近游标绑定城市，并以公开米制距离作为稳定排序边界', () => {
  const query = { ...ORIGIN, radiusMeters: 3000, type: 'sport', city: '澳门', district: '' };
  const after = { distanceMeters: 120, startsAt: '2026-09-11T04:00:00.000Z', id: 'a' };
  const cursor = encodeNearbyCursor(query, after);
  assert.deepEqual(decodeNearbyCursor(cursor, query), after);
  assert.throws(() => decodeNearbyCursor(cursor, { ...query, city: '珠海' }), /筛选条件不匹配/);
});

test('activity.nearby 仅返回半径内坐标活动、按距离排序且不泄露精确坐标', async () => {
  const store = new MemoryStore({ activities: [
    activity('near', 22.1990, 113.5439),
    activity('far', 22.2250, 113.5439),
    activity('legacy', undefined, undefined, { meetingPoint: undefined })
  ] });
  const service = createPinbaService({ store, clock: () => new Date(NOW) });
  const result = await service.execute({
    action: 'activity.nearby', requestId: 'nearby-1',
    data: { ...ORIGIN, coordinateSystem: 'GCJ02', radiusMeters: 3000, limit: 10 }
  }, {});
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.items.map((item) => item.id), ['near', 'far']);
  assert.ok(result.data.items[0].nearby.distanceMeters < result.data.items[1].nearby.distanceMeters);
  assert.equal(result.data.items[0].meetingPoint.label, '公共场馆');
  assert.equal(JSON.stringify(result.data).includes('latitude'), false);
  assert.equal(JSON.stringify(result.data).includes('longitude'), false);
});

test('Cloud 附近查询使用 GeoPoint 与 geoNear，并把索引故障归一为可恢复错误', async () => {
  const reads = [];
  let shouldFail = false;
  const row = { ...activity('cloud', 22.1990, 113.5439), _id: 'cloud' };
  delete row.id;
  const db = {
    Geo: { Point: (longitude, latitude) => ({ longitude, latitude, kind: 'Point' }) },
    command: {
      in: (values) => ({ $in: values }),
      geoNear: (options) => ({ $geoNear: options })
    },
    collection(name) {
      assert.equal(name, 'activities');
      return {
        where(conditions) {
          reads.push(conditions);
          return {
            skip() { return this; }, limit() { return this; },
            async get() {
              if (shouldFail) throw new Error('geo index not found');
              return { data: [row] };
            }
          };
        }
      };
    }
  };
  const store = new CloudStore({ database: () => db });
  const result = await store.listNearbyActivities({ ...ORIGIN, city: '澳门', type: 'sport', radiusMeters: 3000, after: null, limit: 10 }, NOW.toISOString());
  assert.equal(result.items[0].id, 'cloud');
  assert.deepEqual(reads[0].meetingGeoPoint.$geoNear.geometry, { longitude: ORIGIN.longitude, latitude: ORIGIN.latitude, kind: 'Point' });
  assert.equal(reads[0].meetingGeoPoint.$geoNear.maxDistance, 3000);
  assert.deepEqual(reads[0].type, { $in: ['sport', 'buddy'] });
  shouldFail = true;
  await assert.rejects(() => store.listNearbyActivities({ ...ORIGIN, city: '澳门', type: 'sport', radiusMeters: 3000, after: null, limit: 10 }, NOW.toISOString()), (error) => error.code === 'NEARBY_UNAVAILABLE');
});

test('Cloud 发布活动把会合点写成可建地理索引的顶层 GeoPoint', async () => {
  const writes = [];
  const transaction = {
    collection(name) {
      return {
        doc(id) {
          return {
            async get() { return { data: null }; },
            async set({ data }) { writes.push({ name, id, data }); }
          };
        }
      };
    }
  };
  const db = {
    Geo: { Point: (longitude, latitude) => ({ longitude, latitude, kind: 'Point' }) },
    command: {},
    async runTransaction(handler) { return handler(transaction); }
  };
  const store = new CloudStore({ database: () => db });
  const draft = activity('cloud-create', ORIGIN.latitude, ORIGIN.longitude);
  const ownerMember = {
    id: 'member-owner', activityId: draft.id, userId: draft.ownerId, role: 'OWNER',
    status: 'ACTIVE', avatarKind: 'TEXT', joinedAt: NOW.toISOString()
  };
  await store.createActivityWithOwner(draft, ownerMember);
  const saved = writes.find((write) => write.name === 'activities').data;
  assert.deepEqual(saved.meetingGeoPoint, { longitude: ORIGIN.longitude, latitude: ORIGIN.latitude, kind: 'Point' });
  assert.equal(saved.meetingPoint.label, '公共场馆');
  assert.equal(draft.meetingGeoPoint, undefined);
});

test('附近游标只允许在相同坐标、半径与筛选条件下继续使用', async () => {
  const rows = Array.from({ length: 3 }, (_, index) => activity(`page-${index}`, 22.1988 + index * 0.0001, 113.5439));
  const service = createPinbaService({ store: new MemoryStore({ activities: rows }), clock: () => new Date(NOW) });
  const first = await service.execute({ action: 'activity.nearby', requestId: 'page-1', data: { ...ORIGIN, coordinateSystem: 'GCJ02', radiusMeters: 3000, limit: 2 } }, {});
  assert.ok(first.data.nextCursor);
  const second = await service.execute({ action: 'activity.nearby', requestId: 'page-2', data: { ...ORIGIN, coordinateSystem: 'GCJ02', radiusMeters: 3000, limit: 2, cursor: first.data.nextCursor } }, {});
  assert.deepEqual(second.data.items.map((item) => item.id), ['page-2']);
  const mismatched = await service.execute({ action: 'activity.nearby', requestId: 'page-3', data: { ...ORIGIN, coordinateSystem: 'GCJ02', radiusMeters: 5000, limit: 2, cursor: first.data.nextCursor } }, {});
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.error.code, 'VALIDATION_ERROR');
});

test('米级距离相同的附近活动按开始时间与 ID 稳定分页，历史类型补坐标后仍可筛选', async () => {
  const rows = [
    activity('z', 22.1987501, 113.543873, { startsAt: '2026-09-11T05:00:00.000Z' }),
    activity('a', 22.1987502, 113.543873, { startsAt: '2026-09-11T04:00:00.000Z' }),
    activity('legacy-ride', 22.1987503, 113.543873, { type: 'ride', startsAt: '2026-09-11T06:00:00.000Z' })
  ];
  const service = createPinbaService({ store: new MemoryStore({ activities: rows }), clock: () => new Date(NOW) });
  const first = await service.execute({ action: 'activity.nearby', requestId: 'rounded-1', data: { ...ORIGIN, coordinateSystem: 'GCJ02', radiusMeters: 3000, limit: 1 } }, {});
  const second = await service.execute({ action: 'activity.nearby', requestId: 'rounded-2', data: { ...ORIGIN, coordinateSystem: 'GCJ02', radiusMeters: 3000, limit: 2, cursor: first.data.nextCursor } }, {});
  assert.deepEqual([...first.data.items, ...second.data.items].map((item) => item.id), ['a', 'z', 'legacy-ride']);
  const companion = await service.execute({ action: 'activity.nearby', requestId: 'legacy-type', data: { ...ORIGIN, coordinateSystem: 'GCJ02', radiusMeters: 3000, type: 'companion', limit: 10 } }, {});
  assert.deepEqual(companion.data.items.map((item) => item.id), ['legacy-ride']);
});

test('Mock nearby 与正式契约同样校验 city/district、绑定游标并隐藏精确坐标', async () => {
  mockServer.reset();
  const first = await mockServer.call({ action: 'activity.nearby', requestId: 'mock-nearby-1', data: { ...ORIGIN, coordinateSystem: 'GCJ02', radiusMeters: 3000, limit: 1 } });
  assert.equal(first.ok, true);
  assert.ok(first.data.items.length);
  assert.equal(JSON.stringify(first.data).includes('latitude'), false);
  assert.equal(JSON.stringify(first.data).includes('longitude'), false);
  if (first.data.nextCursor) {
    const sameQueryDifferentLimit = await mockServer.call({ action: 'activity.nearby', requestId: 'mock-nearby-2', data: { ...ORIGIN, coordinateSystem: 'GCJ02', radiusMeters: 3000, limit: 2, cursor: first.data.nextCursor } });
    assert.equal(sameQueryDifferentLimit.ok, true);
    const mismatch = await mockServer.call({ action: 'activity.nearby', requestId: 'mock-nearby-2b', data: { ...ORIGIN, coordinateSystem: 'GCJ02', radiusMeters: 5000, limit: 1, cursor: first.data.nextCursor } });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.error.code, 'VALIDATION_ERROR');
  }
  const invalidCity = await mockServer.call({ action: 'activity.nearby', requestId: 'mock-nearby-3', data: { ...ORIGIN, coordinateSystem: 'GCJ02', city: '珠海', radiusMeters: 3000 } });
  assert.equal(invalidCity.ok, false);
  assert.equal(invalidCity.error.code, 'VALIDATION_ERROR');
});
