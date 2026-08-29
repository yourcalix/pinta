'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const locations = require('../miniprogram/config/locations');
const backendConstants = require('../cloudfunctions/api/lib/constants');

const root = path.resolve(__dirname, '..');

test('客户端与服务端共享澳门固定八路线契约', () => {
  assert.equal(locations.PILOT_CITY, '澳门');
  assert.equal(backendConstants.PILOT_CITY, '澳门');
  assert.equal(locations.RIDE_ROUTES.length, 8);
  assert.deepEqual(
    locations.RIDE_ROUTES.map((route) => route.id),
    backendConstants.MACAU_RIDE_ROUTES.map((route) => route.id)
  );
  assert.deepEqual(
    locations.RIDE_ROUTES.map((route) => route.code),
    ['青城', '琴城', '青龍', '琴龍', '城青', '城琴', '龍青', '龍琴']
  );
  assert.deepEqual(
    locations.RIDE_CAMPUS_OPTIONS.slice(1).map((campus) => campus.id),
    backendConstants.MACAU_RIDE_CAMPUS_IDS
  );
});

test('发现页固定为拼车，支持乘客/司机视角与三等分校区分类', () => {
  const script = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.js'), 'utf8');
  const template = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.wxml'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.wxss'), 'utf8');
  assert.match(script, /viewMode:\s*'passenger'/);
  assert.match(script, /campusOptions:\s*RIDE_CAMPUS_OPTIONS/);
  assert.match(script, /type:\s*'ride'/);
  assert.match(script, /campusId:\s*this\.data\.campusId/);
  assert.match(script, /viewMode:\s*this\.data\.viewMode/);
  assert.doesNotMatch(script, /DISTRICT_FILTER_OPTIONS|handleDistrictChange|handleTypeChange/);
  assert.match(script, /我要拼车/);
  assert.match(script, /我是司机/);
  assert.deepEqual(
    locations.RIDE_CAMPUS_OPTIONS.map((item) => item.label),
    ['全部', '凼仔校区', '金龙校区']
  );
  assert.match(template, /campus-chip/);
  assert.doesNotMatch(template, /route-chip|scroll-view class="route-tabs"/);
  assert.match(styles, /\.campus-chip-bar[\s\S]*display:\s*flex/);
  assert.match(styles, /\.campus-chip[\s\S]*flex:\s*1/);
  assert.match(styles, /min-height:\s*88rpx/);
  assert.match(template, /澳门试点/);
  assert.doesNotMatch(template, /拼商品|拼搭子|上海试点/);
});

test('视角切换保留校区筛选，清除筛选同步清空搜索草稿', () => {
  const script = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.js'), 'utf8');
  const viewHandler = script.match(/handleViewModeChange\(event\)[\s\S]*?\n  },/);
  assert.ok(viewHandler);
  assert.doesNotMatch(viewHandler[0], /campusId:\s*''/);
  const clearHandler = script.match(/handleClearFilters\(\)[\s\S]*?\n  },/);
  assert.ok(clearHandler);
  assert.match(clearHandler[0], /campusId:\s*''/);
  assert.match(clearHandler[0], /keyword:\s*''/);
  assert.match(clearHandler[0], /appliedKeyword:\s*''/);
});

test('活动卡片展示完整路线与乘客、司机双状态', () => {
  const display = fs.readFileSync(path.join(root, 'miniprogram/utils/display.js'), 'utf8');
  const template = fs.readFileSync(path.join(root, 'miniprogram/components/activity-card/index.wxml'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'miniprogram/components/activity-card/index.wxss'), 'utf8');
  assert.match(display, /driverStatusLabel/);
  assert.match(display, /maxPassengers/);
  assert.match(display, /originLabel/);
  assert.match(template, /driverStatusLabel/);
  assert.match(template, /capacityLabel/);
  assert.match(styles, /\.route-heading\s*\{[\s\S]*?flex-wrap:\s*wrap/);
  assert.match(styles, /\.card-badges status-badge[\s\S]*?flex-shrink:\s*0/);
});

test('澳门试点发布入口只暴露拼车并以双列滚轮提交固定路线、固定七人和 60 分钟时间窗', () => {
  const entry = fs.readFileSync(path.join(root, 'miniprogram/pages/publish/index.js'), 'utf8');
  const form = fs.readFileSync(path.join(root, 'miniprogram/subpackages/publish/form/index.js'), 'utf8');
  const template = fs.readFileSync(path.join(root, 'miniprogram/subpackages/publish/form/index.wxml'), 'utf8');
  assert.doesNotMatch(entry, /value:\s*'product'|value:\s*'buddy'/);
  assert.match(form, /routeOptions:\s*RIDE_ROUTES/);
  assert.match(form, /minPassengers:\s*7/);
  assert.match(form, /maxPassengers:\s*7/);
  assert.match(form, /pickupWindowEnd/);
  assert.match(template, /mode="multiSelector"/);
  assert.match(template, /bindcolumnchange="handleRouteColumnChange"/);
  assert.match(template, /起点与终点/);
  assert.match(template, /固定 7 名乘客成团/);
  assert.doesNotMatch(template, /number-stepper|最低成团人数|最大乘客数/);
  assert.doesNotMatch(template, /商品名称|活动类别|行政区/);
});

test('详情页按视角隔离乘客申请与司机承接，承接时间为 4 个 15 分钟档', () => {
  const script = fs.readFileSync(path.join(root, 'miniprogram/subpackages/activity/detail/index.js'), 'utf8');
  const template = fs.readFileSync(path.join(root, 'miniprogram/subpackages/activity/detail/index.wxml'), 'utf8');
  assert.match(script, /buildPickupSlots/);
  assert.match(script, /RIDE_ALREADY_ASSIGNED/);
  assert.match(script, /activityService\.driverProfile/);
  assert.match(script, /activityService\.acceptRide/);
  assert.match(template, /司机承接/);
  assert.match(template, /pickup-slot/);
  assert.match(template, /viewMode === 'passenger'/);
  assert.match(template, /viewMode === 'driver'/);
  assert.match(template, /司机资格审核中|暂不可承接/);
  assert.match(script, /canAcceptRide/);
  assert.doesNotMatch(template, /reviewStatus/);
  assert.match(template, /class="detail-content" aria-hidden="\{\{driverSheetVisible \|\| qaModal\.visible\}\}"/);
});

test('发布人数规则固定为七名乘客且不再暴露步进器', () => {
  const script = fs.readFileSync(path.join(root, 'miniprogram/subpackages/publish/form/index.js'), 'utf8');
  assert.doesNotMatch(script, /handleNumber\(/);
  assert.match(script, /common\.minPassengers = 7/);
  assert.match(script, /common\.maxPassengers = 7/);
});

test('我的页面分离我的拼车与司机任务，Mock 提供审核通过司机身份', () => {
  const script = fs.readFileSync(path.join(root, 'miniprogram/pages/user/index.js'), 'utf8');
  const template = fs.readFileSync(path.join(root, 'miniprogram/pages/user/index.wxml'), 'utf8');
  const mock = fs.readFileSync(path.join(root, 'miniprogram/mocks/server.js'), 'utf8');
  assert.match(script, /dashboardMode:\s*'rides'/);
  assert.match(script, /activityService\.driverProfile/);
  assert.match(script, /activityService\.driverMine/);
  assert.match(template, /我的拼车/);
  assert.match(template, /司机任务/);
  assert.match(template, /成为澳门校园认证合乘司机/);
  assert.match(mock, /id:\s*'u_driver'/);
  assert.match(mock, /reviewStatus:\s*'APPROVED'/);
});

test('Mock 可完整演示成团后由认证司机承接', async () => {
  const mockServer = require('../miniprogram/mocks/server');
  mockServer.reset();
  mockServer.setPersona('u_owner');
  const applications = await mockServer.call({
    action: 'application.listForOwner',
    data: { activityId: 'a_ride' },
    requestId: 'mock-applications'
  });
  await mockServer.call({
    action: 'application.approve',
    data: { activityId: 'a_ride', applicationId: applications.data.items[0].id },
    requestId: 'mock-approve',
    idempotencyKey: 'mock-approve-ride-12345678'
  });
  const approvedReplay = await mockServer.call({
    action: 'application.approve',
    data: { activityId: 'a_ride', applicationId: applications.data.items[0].id },
    requestId: 'mock-approve-replay',
    idempotencyKey: 'mock-approve-ride-replay-12345678'
  });
  assert.equal(approvedReplay.ok, true);
  mockServer.setPersona('u_driver');
  const detail = await mockServer.call({ action: 'activity.detail', data: { activityId: 'a_ride' }, requestId: 'mock-detail' });
  const insufficientVehicle = await mockServer.call({
    action: 'ride.driver.accept',
    data: {
      activityId: 'a_ride',
      vehicleId: 'vehicle_driver_small',
      pickupAt: detail.data.activity.startsAt
    },
    requestId: 'mock-accept-small',
    idempotencyKey: 'mock-driver-small-12345678'
  });
  assert.equal(insufficientVehicle.ok, false);
  assert.equal(insufficientVehicle.error.code, 'VEHICLE_NOT_APPROVED');
  const accepted = await mockServer.call({
    action: 'ride.driver.accept',
    data: {
      activityId: 'a_ride',
      vehicleId: 'vehicle_driver_1',
      pickupAt: detail.data.activity.startsAt
    },
    requestId: 'mock-accept',
    idempotencyKey: 'mock-driver-accept-12345678'
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.data.fulfillment.status, 'ASSIGNED');
  assert.equal(accepted.data.activity.rideJoinable, true);
  const mine = await mockServer.call({ action: 'ride.driver.mine', data: {}, requestId: 'mock-driver-mine' });
  assert.equal(mine.data.items.length, 1);
  const cancelled = await mockServer.call({
    action: 'ride.driver.cancel',
    data: { activityId: 'a_ride', reason: '临时无法到达' },
    requestId: 'mock-driver-cancel',
    idempotencyKey: 'mock-driver-cancel-12345678'
  });
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.data.activity.rideJoinable, true);
  mockServer.setPersona('u_owner');
  const activityCancelled = await mockServer.call({
    action: 'activity.cancel',
    data: { activityId: 'a_ride', reason: '计划调整' },
    requestId: 'mock-activity-cancel',
    idempotencyKey: 'mock-activity-cancel-12345678'
  });
  assert.equal(activityCancelled.ok, true);
  assert.equal(activityCancelled.data.activity.rideJoinable, false);
});

test('Mock 发布拒绝非法容量与非 60 分钟接车窗口', async () => {
  const mockServer = require('../miniprogram/mocks/server');
  mockServer.reset();
  mockServer.setPersona('u_owner');
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
  const base = {
    type: 'ride',
    title: '青茂口岸到凼仔校区同行',
    description: '校园公益合乘',
    city: '澳门',
    district: '澳门校园',
    placeLabel: '青茂口岸 → 凼仔校区',
    startsAt: start.toISOString(),
    deadlineAt: new Date(start.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    minPassengers: 4,
    maxPassengers: 3,
    luggageType: 'SMALL',
    contactInfo: '+85361234567',
    rules: '',
    typeData: {
      routeId: 'QINGMAO_TO_TAIPA',
      pickupWindowEnd: new Date(start.getTime() + 45 * 60 * 1000).toISOString(),
      feeType: 'NO_COST'
    }
  };
  const invalid = await mockServer.call({
    action: 'activity.create',
    data: base,
    requestId: 'mock-invalid-ride-create',
    idempotencyKey: 'mock-invalid-ride-12345678'
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'VALIDATION_ERROR');

  const valid = await mockServer.call({
    action: 'activity.create',
    data: {
      ...base,
      minPassengers: 7,
      maxPassengers: 7,
      typeData: {
        ...base.typeData,
        pickupWindowEnd: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
        feeType: 'FREE'
      }
    },
    requestId: 'mock-valid-ride-create',
    idempotencyKey: 'mock-valid-ride-12345678'
  });
  assert.equal(valid.ok, true);
});
