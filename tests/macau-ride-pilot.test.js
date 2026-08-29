'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPinbaService } = require('../cloudfunctions/api/lib/service');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');
const { validateActivityInput } = require('../cloudfunctions/api/lib/validation');
const {
  MACAU_RIDE_ROUTES,
  PILOT_CITY,
  RIDE_FULFILLMENT_STATUS
} = require('../cloudfunctions/api/lib/constants');
const { ridePassengerJoinUnavailableReason } = require('../cloudfunctions/api/lib/ride-policy');

const NOW = new Date('2026-08-23T02:00:00.000Z');

function user(id, nickname) {
  return {
    id,
    role: 'user',
    status: 'ACTIVE',
    profile: {
      nickname,
      city: '澳门',
      interests: ['校园出行'],
      adultConfirmed: true
    },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString()
  };
}

function rideInput(overrides = {}) {
  return {
    type: 'ride',
    title: '青茂口岸到凼仔校区拼车',
    description: '寻找同路线同学，一起乘坐合规车辆',
    city: '澳门',
    district: '澳门校园',
    placeLabel: '青茂口岸 → 凼仔校区',
    startsAt: '2026-08-24T10:00:00.000Z',
    deadlineAt: '2026-08-24T08:00:00.000Z',
    minPassengers: 7,
    maxPassengers: 7,
    luggageType: 'SMALL',
    contactInfo: '微信号 pinba_macau',
    rules: '请按确认时间提前到达上车点',
    typeData: {
      routeId: 'QINGMAO_TO_TAIPA',
      pickupWindowEnd: '2026-08-24T11:00:00.000Z',
      feeType: 'NO_COST'
    },
    ...overrides
  };
}

function setup(options = {}) {
  const users = [
    user('owner-openid', '发起者'),
    user('member-openid', '乘客甲'),
    user('second-openid', '乘客乙'),
    user('third-openid', '乘客丙'),
    user('fourth-openid', '乘客丁'),
    user('fifth-openid', '乘客戊'),
    user('sixth-openid', '乘客己'),
    user('driver-one-openid', '司机甲'),
    user('driver-two-openid', '司机乙'),
    user('pending-driver-openid', '待审司机')
  ];
  const store = new MemoryStore({
    users,
    drivers: [
      {
        id: 'driver-one-openid',
        userId: 'driver-one-openid',
        status: 'ACTIVE',
        reviewStatus: 'APPROVED',
        licenseType: 'MACAU_TAXI_DRIVER',
        licenseNumber: 'PRIVATE-LICENSE-ONE'
      },
      {
        id: 'driver-two-openid',
        userId: 'driver-two-openid',
        status: 'ACTIVE',
        reviewStatus: 'APPROVED',
        licenseType: 'MACAU_TAXI_DRIVER',
        licenseNumber: 'PRIVATE-LICENSE-TWO'
      },
      {
        id: 'pending-driver-openid',
        userId: 'pending-driver-openid',
        status: 'ACTIVE',
        reviewStatus: 'PENDING',
        licenseType: 'MACAU_TAXI_DRIVER',
        licenseNumber: 'PRIVATE-LICENSE-PENDING'
      }
    ],
    vehicles: [
      {
        id: 'vehicle-one',
        driverId: 'driver-one-openid',
        status: 'ACTIVE',
        reviewStatus: 'APPROVED',
        type: 'TAXI',
        plateNumber: 'M-12-34',
        plateMasked: 'M-**-34',
        passengerCapacity: 7
      },
      {
        id: 'vehicle-two',
        driverId: 'driver-two-openid',
        status: 'ACTIVE',
        reviewStatus: 'APPROVED',
        type: 'TAXI',
        plateNumber: 'M-56-78',
        plateMasked: 'M-**-78',
        passengerCapacity: 7
      }
    ]
  });
  let sequence = 0;
  let currentTime = new Date(options.now || NOW);
  const service = createPinbaService({
    store,
    clock: () => new Date(currentTime),
    idGenerator: () => `macau-id-${++sequence}`,
    rideDriverAcceptanceEnabled: options.rideDriverAcceptanceEnabled !== false
  });
  let requests = 0;
  async function call(action, data = {}, actorId = null, key) {
    requests += 1;
    return service.execute({
      action,
      data,
      requestId: `macau-request-${requests}`,
      ...(key ? { idempotencyKey: key } : {})
    }, actorId ? { actorId } : {});
  }
  return {
    store,
    call,
    setNow(value) {
      currentTime = new Date(value);
    }
  };
}

async function createAndFormRide(call, suffix = 'base') {
  const created = await call('activity.create', rideInput(), 'owner-openid', `create-macau-${suffix}`);
  assert.equal(created.ok, true);
  const activityId = created.data.activity.id;
  assert.equal(created.data.activity.status, 'RECRUITING');
  return { activityId, created };
}

test('澳门试点只暴露八条稳定路线且完整覆盖四个站点往返', () => {
  assert.equal(PILOT_CITY, '澳门');
  assert.equal(MACAU_RIDE_ROUTES.length, 8);
  assert.deepEqual(MACAU_RIDE_ROUTES.map((route) => route.code), [
    '青城', '琴城', '青龍', '琴龍', '城青', '城琴', '龍青', '龍琴'
  ]);
  assert.equal(new Set(MACAU_RIDE_ROUTES.map((route) => route.id)).size, 8);
});

test('拼车发布只接受固定路线、固定七名乘客和整整 60 分钟接车窗口', () => {
  const validated = validateActivityInput(rideInput(), NOW);
  assert.equal(validated.city, '澳门');
  assert.equal(validated.targetMembers, 7);
  assert.equal(validated.minPassengers, 7);
  assert.equal(validated.maxPassengers, 7);
  assert.equal(validated.luggageType, 'SMALL');
  assert.equal(validated.typeData.luggageRule, undefined);
  assert.deepEqual(validated.typeData.origin, { id: 'QINGMAO', label: '青茂口岸' });
  assert.deepEqual(validated.typeData.destination, { id: 'TAIPA_CAMPUS', label: '凼仔校区' });

  assert.throws(
    () => validateActivityInput(rideInput({ luggageType: undefined }), NOW),
    (error) => error.code === 'VALIDATION_ERROR' && error.details.field === 'luggageType'
  );
  assert.throws(
    () => validateActivityInput(rideInput({
      typeData: { ...rideInput().typeData, routeId: 'FREE_TEXT_ROUTE' }
    }), NOW),
    (error) => error.code === 'VALIDATION_ERROR'
  );
  assert.throws(
    () => validateActivityInput(rideInput({ minPassengers: 6, maxPassengers: 7 }), NOW),
    (error) => error.code === 'VALIDATION_ERROR'
  );
  assert.throws(
    () => validateActivityInput(rideInput({
      typeData: { ...rideInput().typeData, pickupWindowEnd: '2026-08-24T10:45:00.000Z' }
    }), NOW),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});

test('拼车累计七名乘客后满员并关闭剩余申请', async () => {
  const { call, store } = setup();
  const { activityId } = await createAndFormRide(call, 'capacity');
  const passengerIds = ['member-openid', 'second-openid', 'third-openid', 'fourth-openid', 'fifth-openid'];
  for (const [index, passengerId] of passengerIds.entries()) {
    const applied = await call('application.submit', { activityId, note: '', autoJoinConsent: true }, passengerId, `apply-capacity-${index}`);
    const approved = await call('application.approve', { activityId, applicationId: applied.data.application.id }, 'owner-openid', `approve-capacity-${index}`);
    assert.equal(approved.ok, true);
    assert.equal(approved.data.activity.status, 'RECRUITING');
  }
  const pendingAtFull = await call('application.submit', {
    activityId,
    note: '',
    autoJoinConsent: true
  }, 'member-openid', 'apply-pending-at-full-001');
  assert.equal(pendingAtFull.ok, false);
  const last = await call('application.submit', {
    activityId,
    note: '',
    autoJoinConsent: true
  }, 'sixth-openid', 'apply-last-seat-001');
  const extraPending = await call('application.submit', {
    activityId,
    note: '',
    autoJoinConsent: true
  }, 'pending-driver-openid', 'apply-extra-pending-001');
  assert.equal(extraPending.ok, true);
  const full = await call('application.approve', {
    activityId,
    applicationId: last.data.application.id
  }, 'owner-openid', 'approve-last-seat-001');
  assert.equal(full.ok, true);
  assert.equal(full.data.activity.memberCount, 7);
  assert.equal(full.data.activity.status, 'FORMED');
  assert.equal(full.data.activity.maxPassengers, 7);
  assert.equal(store.applications.get(extraPending.data.application.id).status, 'CANCELLED_BY_ACTIVITY');

  const overflow = await call('application.submit', {
    activityId,
    note: '',
    autoJoinConsent: true
  }, 'pending-driver-openid', 'apply-overflow-001');
  assert.equal(overflow.ok, false);
  assert.equal(overflow.error.code, 'CAPACITY_FULL');
});

test('旧数据即使残留成团状态也必须满七名乘客后才能解锁联系方式', async () => {
  const { call, store } = setup();
  const { activityId } = await createAndFormRide(call, 'legacy-contact-gate');
  const activity = store.activities.get(activityId);
  activity.status = 'FORMED';
  activity.memberCount = 2;
  activity.targetMembers = 2;
  activity.minPassengers = 2;
  activity.maxPassengers = 4;

  const blocked = await call('group.contact', { activityId }, 'owner-openid');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'CONFLICT');

  activity.memberCount = 7;
  const aggregateOnly = await call('group.contact', { activityId }, 'owner-openid');
  assert.equal(aggregateOnly.ok, false);
  assert.equal(aggregateOnly.error.code, 'CONFLICT');

  for (const passengerId of [
    'member-openid',
    'second-openid',
    'third-openid',
    'fourth-openid',
    'fifth-openid',
    'sixth-openid'
  ]) {
    store.members.set(`legacy-member-${passengerId}`, {
      id: `legacy-member-${passengerId}`,
      activityId,
      userId: passengerId,
      role: 'MEMBER',
      status: 'ACTIVE',
      joinedAt: NOW.toISOString()
    });
  }
  const unlocked = await call('group.contact', { activityId }, 'owner-openid');
  assert.equal(unlocked.ok, true);
  assert.equal(unlocked.data.contactInfo, '微信号 pinba_macau');
});

test('司机承接在生产门禁未开启时 fail-closed', async () => {
  const { call } = setup({ rideDriverAcceptanceEnabled: false });
  const { activityId } = await createAndFormRide(call, 'closed');
  const accepted = await call('ride.driver.accept', {
    activityId,
    vehicleId: 'vehicle-one',
    pickupAt: '2026-08-24T10:15:00.000Z'
  }, 'driver-one-openid', 'accept-closed-001');
  assert.equal(accepted.ok, false);
  assert.equal(accepted.error.code, 'DRIVER_ACCEPTANCE_CLOSED');
});

test('司机资料 DTO 只暴露承接能力与脱敏车辆信息', async () => {
  const { call } = setup();
  const profile = await call('ride.driver.profile', {}, 'driver-one-openid');
  assert.equal(profile.ok, true);
  assert.equal(profile.data.driver.canAcceptRide, true);
  assert.equal(profile.data.driver.vehicles[0].canUseForRide, true);
  assert.equal(JSON.stringify(profile.data).includes('reviewStatus'), false);
  assert.equal(JSON.stringify(profile.data).includes('licenseNumber'), false);
  assert.equal(JSON.stringify(profile.data).includes('plateNumber'), false);
});

test('申请在报名截止前提交但截止后才审批时必须 fail-closed', async () => {
  const { call, setNow, store } = setup();
  const created = await call('activity.create', rideInput(), 'owner-openid', 'create-before-deadline-001');
  const activityId = created.data.activity.id;
  const applied = await call('application.submit', {
    activityId,
    note: '截止前提交',
    autoJoinConsent: true
  }, 'member-openid', 'apply-before-deadline-001');
  setNow('2026-08-24T08:00:00.001Z');
  const approved = await call('application.approve', {
    activityId,
    applicationId: applied.data.application.id
  }, 'owner-openid', 'approve-after-deadline-001');
  assert.equal(approved.ok, false);
  assert.equal(approved.error.code, 'CONFLICT');
  assert.equal(store.applications.get(applied.data.application.id).status, 'PENDING');
});

test('只有审核通过的司机和车辆可在时间窗内按 15 分钟档提前承接行程', async () => {
  const { call } = setup();
  const { activityId } = await createAndFormRide(call, 'driver-rules');

  const pending = await call('ride.driver.accept', {
    activityId,
    vehicleId: 'vehicle-one',
    pickupAt: '2026-08-24T10:15:00.000Z'
  }, 'pending-driver-openid', 'accept-pending-driver-001');
  assert.equal(pending.ok, false);
  assert.equal(pending.error.code, 'DRIVER_NOT_APPROVED');

  const invalidSlot = await call('ride.driver.accept', {
    activityId,
    vehicleId: 'vehicle-one',
    pickupAt: '2026-08-24T10:10:00.000Z'
  }, 'driver-one-openid', 'accept-invalid-slot-001');
  assert.equal(invalidSlot.ok, false);
  assert.equal(invalidSlot.error.code, 'INVALID_PICKUP_SLOT');

  const accepted = await call('ride.driver.accept', {
    activityId,
    vehicleId: 'vehicle-one',
    pickupAt: '2026-08-24T10:15:00.000Z'
  }, 'driver-one-openid', 'accept-valid-001');
  assert.equal(accepted.ok, true);
  assert.equal(accepted.data.fulfillment.status, RIDE_FULFILLMENT_STATUS.ASSIGNED);
  assert.equal(accepted.data.fulfillment.pickupAt, '2026-08-24T10:15:00.000Z');
  assert.deepEqual(accepted.data.fulfillment.driver, { nickname: '司机甲' });
  assert.deepEqual(accepted.data.fulfillment.vehicle, { type: 'TAXI', plateMasked: 'M-**-34' });
  assert.equal(accepted.data.activity.status, 'RECRUITING');
  assert.equal(accepted.data.activity.rideJoinable, true);
  assert.equal(JSON.stringify(accepted.data).includes('PRIVATE-LICENSE'), false);
  assert.equal(JSON.stringify(accepted.data).includes('M-12-34'), false);

  const driverMine = await call('ride.driver.mine', {}, 'driver-one-openid');
  assert.equal(driverMine.ok, true);
  assert.equal(driverMine.data.items.length, 1);
  assert.equal(driverMine.data.items[0].rideFulfillment.status, RIDE_FULFILLMENT_STATUS.ASSIGNED);

  const passengerList = await call('activity.list', { type: 'ride', viewMode: 'passenger', limit: 10 });
  assert.equal(passengerList.data.items.some((item) => item.id === activityId), true);
});

test('并发语义下同一行程只能由一个司机承接并返回稳定业务错误码', async () => {
  const { call, store } = setup();
  const { activityId } = await createAndFormRide(call, 'single-driver');
  const first = await call('ride.driver.accept', {
    activityId,
    vehicleId: 'vehicle-one',
    pickupAt: '2026-08-24T10:15:00.000Z'
  }, 'driver-one-openid', 'accept-first-driver-001');
  assert.equal(first.ok, true);

  const second = await call('ride.driver.accept', {
    activityId,
    vehicleId: 'vehicle-two',
    pickupAt: '2026-08-24T10:30:00.000Z'
  }, 'driver-two-openid', 'accept-second-driver-001');
  assert.equal(second.ok, false);
  assert.equal(second.error.code, 'RIDE_ALREADY_ASSIGNED');
  assert.equal(store.rideFulfillments.get(activityId).driverId, 'driver-one-openid');
});

test('接车事实源已分配后仍允许乘客申请和审批直到七人满员', async () => {
  const { call, store } = setup();
  const { activityId } = await createAndFormRide(call, 'stale-fulfillment-mirror');
  const pending = await call('application.submit', {
    activityId,
    note: '司机确认前提交',
    autoJoinConsent: true
  }, 'second-openid', 'apply-before-assigned-001');
  assert.equal(pending.ok, true);

  const accepted = await call('ride.driver.accept', {
    activityId,
    vehicleId: 'vehicle-one',
    pickupAt: '2026-08-24T10:15:00.000Z'
  }, 'driver-one-openid', 'accept-before-stale-mirror-001');
  assert.equal(accepted.ok, true);

  const staleActivity = store.activities.get(activityId);
  staleActivity.rideFulfillment = { status: RIDE_FULFILLMENT_STATUS.UNASSIGNED };
  staleActivity.rideJoinable = true;

  const lateApplication = await call('application.submit', {
    activityId,
    note: '司机确认后提交',
    autoJoinConsent: true
  }, 'third-openid', 'apply-after-assigned-001');
  assert.equal(lateApplication.ok, true);

  const lateApproval = await call('application.approve', {
    activityId,
    applicationId: pending.data.application.id
  }, 'owner-openid', 'approve-after-assigned-001');
  assert.equal(lateApproval.ok, true);
  assert.equal(store.applications.get(pending.data.application.id).status, 'APPROVED');

  const passengerList = await call('activity.list', { type: 'ride', viewMode: 'passenger', limit: 10 });
  assert.equal(passengerList.data.items.some((item) => item.id === activityId), true);

  const ownerMine = await call('activity.mine', {}, 'owner-openid');
  const ownedRide = ownerMine.data.owned.find((item) => item.id === activityId);
  assert.equal(ownedRide.rideFulfillment.status, RIDE_FULFILLMENT_STATUS.ASSIGNED);

  await assert.rejects(
    () => store.leaveActivity(activityId, 'member-openid', '行程有变', '2026-08-23T03:00:00.000Z'),
    (error) => error.code === 'RIDE_MEMBER_LOCKED' && /司机已确认/.test(error.message)
  );
  assert.equal(store.activities.get(activityId).status, 'RECRUITING');
  assert.equal(store.activities.get(activityId).memberCount, 2);
});

test('拼车乘客直接入团且司机承接前可退出，承接后仍可补足名额但旧成员不可退出', async () => {
  const { call, store } = setup();
  const { activityId } = await createAndFormRide(call, 'direct-join-leave');

  const guestDetail = await call('activity.detail', { activityId }, 'second-openid');
  assert.equal(guestDetail.ok, true);
  assert.equal(guestDetail.data.activity.status, 'RECRUITING');
  assert.equal(guestDetail.data.activity.canJoinRide, true);
  assert.equal(guestDetail.data.activity.joinUnavailableReason, '');

  const ownerDetail = await call('activity.detail', { activityId }, 'owner-openid');
  assert.equal(ownerDetail.data.activity.canJoinRide, false);
  assert.equal(ownerDetail.data.activity.joinUnavailableReason, '这是你发布的行程');

  const ownerMember = [...store.members.values()].find((item) => item.activityId === activityId && item.role === 'OWNER');
  assert.equal(ownerMember.luggageType, 'SMALL');

  const missingLuggage = await call('ride.join', { activityId }, 'member-openid', 'direct-join-missing-001');
  assert.equal(missingLuggage.ok, false);
  assert.equal(missingLuggage.error.code, 'VALIDATION_ERROR');

  await assert.rejects(
    () => store.joinRideAtomic({
      activityId,
      actorId: 'member-openid',
      luggageType: 'INVALID',
      at: '2026-08-23T02:05:00.000Z'
    }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
  assert.equal(store.activities.get(activityId).memberCount, 1);

  const joined = await call('ride.join', { activityId, luggageType: 'SMALL' }, 'member-openid', 'direct-join-001');
  assert.equal(joined.ok, true);
  assert.equal(joined.data.activity.viewerRole, 'member');
  assert.equal(joined.data.activity.viewerMembership.luggageType, 'SMALL');
  assert.equal(joined.data.activity.canLeaveRide, true);
  assert.equal(joined.data.activity.joinUnavailableReason, '你已加入该行程');
  assert.equal(store.activities.get(activityId).memberCount, 2);

  const replayed = await call('ride.join', { activityId, luggageType: 'LARGE' }, 'member-openid', 'direct-join-active-002');
  assert.equal(replayed.ok, true);
  assert.equal(store.activities.get(activityId).memberCount, 2);
  assert.equal(replayed.data.activity.viewerMembership.luggageType, 'SMALL');

  const left = await call('member.leave', { activityId, reason: '计划变化' }, 'member-openid', 'direct-leave-001');
  assert.equal(left.ok, true);
  assert.equal(store.activities.get(activityId).memberCount, 1);

  const rejoined = await call('ride.join', { activityId, luggageType: 'LARGE' }, 'member-openid', 'direct-rejoin-001');
  assert.equal(rejoined.ok, true);
  assert.equal(store.activities.get(activityId).memberCount, 2);
  assert.equal(rejoined.data.activity.viewerMembership.luggageType, 'LARGE');

  const accepted = await call('ride.driver.accept', {
    activityId,
    vehicleId: 'vehicle-one',
    pickupAt: '2026-08-24T10:15:00.000Z'
  }, 'driver-one-openid', 'direct-accept-001');
  assert.equal(accepted.ok, true);

  const driverDetail = await call('activity.detail', { activityId }, 'driver-one-openid');
  assert.equal(driverDetail.ok, true);
  assert.equal(driverDetail.data.activity.viewerRole, 'driver');
  assert.equal(driverDetail.data.activity.canJoinRide, false);
  assert.equal(driverDetail.data.activity.joinUnavailableReason, '你已承接该行程，不能同时作为乘客');

  const lateJoin = await call('ride.join', { activityId, luggageType: 'NONE' }, 'second-openid', 'direct-late-join-001');
  assert.equal(lateJoin.ok, true);
  assert.equal(store.activities.get(activityId).memberCount, 3);

  const lockedLeave = await call('member.leave', { activityId, reason: '计划变化' }, 'member-openid', 'direct-locked-leave-001');
  assert.equal(lockedLeave.ok, false);
  assert.equal(lockedLeave.error.code, 'RIDE_MEMBER_LOCKED');
});

test('拼车不可加入原因对满员、截止、终态和畸形时间保持稳定契约', () => {
  const base = {
    type: 'ride',
    status: 'RECRUITING',
    memberCount: 1,
    deadlineAt: '2026-08-24T08:00:00.000Z'
  };
  assert.equal(ridePassengerJoinUnavailableReason({ ...base, memberCount: 7 }, NOW.toISOString()), '行程已满员');
  assert.equal(ridePassengerJoinUnavailableReason(base, '2026-08-24T08:00:00.000Z'), '报名已截止');
  assert.equal(ridePassengerJoinUnavailableReason({ ...base, status: 'CANCELLED' }, NOW.toISOString()), '行程已取消');
  assert.equal(ridePassengerJoinUnavailableReason({ ...base, status: 'EXPIRED' }, NOW.toISOString()), '行程已过期');
  assert.equal(ridePassengerJoinUnavailableReason({ ...base, deadlineAt: 'invalid' }, NOW.toISOString()), '加入资格暂不可用，请稍后重试');
});

test('已过接车窗口的行程不会出现在司机列表且不可承接', async () => {
  const { call, store } = setup();
  const { activityId } = await createAndFormRide(call, 'expired-window');
  const activity = store.activities.get(activityId);
  activity.startsAt = '2026-08-23T00:00:00.000Z';
  activity.deadlineAt = '2026-08-22T23:00:00.000Z';
  activity.typeData.pickupWindowEnd = '2026-08-23T01:00:00.000Z';

  const driverList = await call('activity.list', { type: 'ride', viewMode: 'driver', limit: 10 });
  assert.equal(driverList.data.items.some((item) => item.id === activityId), false);
  const accepted = await call('ride.driver.accept', {
    activityId,
    vehicleId: 'vehicle-one',
    pickupAt: '2026-08-23T00:30:00.000Z'
  }, 'driver-one-openid', 'accept-expired-window-001');
  assert.equal(accepted.ok, false);
  assert.equal(accepted.error.code, 'PICKUP_TIME_EXPIRED');
});

test('报名截止后但接车时间未到时司机仍可提前承接', async () => {
  const { call, setNow } = setup();
  const { activityId } = await createAndFormRide(call, 'after-signup-deadline');
  setNow('2026-08-24T09:00:00.000Z');

  const driverList = await call('activity.list', { type: 'ride', viewMode: 'driver', limit: 10 });
  assert.equal(driverList.ok, true);
  assert.equal(driverList.data.items.some((item) => item.id === activityId), true);

  const accepted = await call('ride.driver.accept', {
    activityId,
    vehicleId: 'vehicle-one',
    pickupAt: '2026-08-24T10:15:00.000Z'
  }, 'driver-one-openid', 'accept-after-signup-deadline-001');
  assert.equal(accepted.ok, true);
  assert.equal(accepted.data.activity.status, 'RECRUITING');
  assert.equal(accepted.data.activity.driverAcceptable, false);
  assert.equal(accepted.data.activity.driverUnacceptableReason, '该行程已有司机确认');
});

test('旧数据接车窗口若超过 60 分钟仍不可承接第二小时档位', async () => {
  const { call, store } = setup();
  const { activityId } = await createAndFormRide(call, 'legacy-wide-window');
  store.activities.get(activityId).typeData.pickupWindowEnd = '2026-08-24T12:00:00.000Z';
  const accepted = await call('ride.driver.accept', {
    activityId,
    vehicleId: 'vehicle-one',
    pickupAt: '2026-08-24T11:15:00.000Z'
  }, 'driver-one-openid', 'accept-wide-window-001');
  assert.equal(accepted.ok, false);
  assert.equal(accepted.error.code, 'INVALID_PICKUP_SLOT');
});

test('已承接司机可受控取消并恢复待承接，其他司机随后可承接', async () => {
  const { call, store } = setup();
  const { activityId } = await createAndFormRide(call, 'cancel-driver');
  await call('ride.driver.accept', {
    activityId,
    vehicleId: 'vehicle-one',
    pickupAt: '2026-08-24T10:15:00.000Z'
  }, 'driver-one-openid', 'accept-before-cancel-001');

  const cancelled = await call('ride.driver.cancel', {
    activityId,
    reason: '临时无法按时到达'
  }, 'driver-one-openid', 'cancel-driver-001');
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.data.fulfillment.status, RIDE_FULFILLMENT_STATUS.UNASSIGNED);
  assert.ok(store.auditLogs.size >= 3);

  const reassigned = await call('ride.driver.accept', {
    activityId,
    vehicleId: 'vehicle-two',
    pickupAt: '2026-08-24T10:30:00.000Z'
  }, 'driver-two-openid', 'accept-after-cancel-001');
  assert.equal(reassigned.ok, true);
  assert.deepEqual(reassigned.data.fulfillment.driver, { nickname: '司机乙' });
});

test('活动取消后司机再取消承接不会错误恢复可加入镜像', async () => {
  const { call, store } = setup();
  const { activityId } = await createAndFormRide(call, 'cancelled-activity');
  await call('ride.driver.accept', {
    activityId,
    vehicleId: 'vehicle-one',
    pickupAt: '2026-08-24T10:15:00.000Z'
  }, 'driver-one-openid', 'accept-before-activity-cancel-001');
  await call('activity.cancel', { activityId, reason: '行程计划取消' }, 'owner-openid', 'cancel-activity-ride-001');
  const cancelled = await call('ride.driver.cancel', {
    activityId,
    reason: '活动已经取消'
  }, 'driver-one-openid', 'cancel-driver-after-activity-001');
  assert.equal(cancelled.ok, true);
  assert.equal(store.activities.get(activityId).status, 'CANCELLED');
  assert.equal(store.activities.get(activityId).rideJoinable, false);
});

test('拼车完成或平台下架后持久化可加入镜像必须清零', async () => {
  const completedSetup = setup();
  const completedRide = await createAndFormRide(completedSetup.call, 'complete-mirror');
  completedSetup.store.activities.get(completedRide.activityId).status = 'FORMED';
  completedSetup.store.activities.get(completedRide.activityId).memberCount = 7;
  const completed = await completedSetup.call(
    'activity.complete',
    { activityId: completedRide.activityId },
    'owner-openid',
    'complete-mirror-001'
  );
  assert.equal(completed.ok, true);
  assert.equal(completedSetup.store.activities.get(completedRide.activityId).rideJoinable, false);

  const suspendedSetup = setup();
  const suspendedRide = await createAndFormRide(suspendedSetup.call, 'suspend-mirror');
  suspendedSetup.store.users.set('admin-openid', user('admin-openid', '运营'));
  suspendedSetup.store.users.get('admin-openid').role = 'admin';
  const suspended = await suspendedSetup.call(
    'admin.activity.suspend',
    { activityId: suspendedRide.activityId, reason: '测试下架' },
    'admin-openid',
    'suspend-mirror-001'
  );
  assert.equal(suspended.ok, true);
  assert.equal(suspendedSetup.store.activities.get(suspendedRide.activityId).rideJoinable, false);
});
