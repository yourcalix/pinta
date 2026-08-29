'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPinbaService } = require('../cloudfunctions/api/lib/service');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');
const { normalizeRidePhone } = require('../cloudfunctions/api/lib/phone');

const NOW = new Date('2026-08-23T02:00:00.000Z');

function user(id, nickname) {
  return {
    id,
    role: 'user',
    status: 'ACTIVE',
    profile: { nickname, city: '澳门', interests: ['校园出行'], adultConfirmed: true },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString()
  };
}

function rideInput() {
  return {
    type: 'ride',
    title: '青茂口岸到凼仔校区拼车',
    description: '寻找同路同学',
    city: '澳门',
    district: '澳门校园',
    placeLabel: '青茂口岸 → 凼仔校区',
    startsAt: '2026-08-24T10:00:00.000Z',
    deadlineAt: '2026-08-24T08:00:00.000Z',
    minPassengers: 7,
    maxPassengers: 7,
    luggageType: 'SMALL',
    contactInfo: '+853 6123 4567',
    rules: '请提前到达',
    typeData: {
      routeId: 'QINGMAO_TO_TAIPA',
      pickupWindowEnd: '2026-08-24T11:00:00.000Z',
      feeType: 'NO_COST'
    }
  };
}

function setup() {
  const store = new MemoryStore({
    users: [user('owner', '发起者'), user('member', '乘客甲'), user('driver', '司机甲'), user('other-driver', '司机乙')],
    drivers: [
      { id: 'driver', userId: 'driver', status: 'ACTIVE', reviewStatus: 'APPROVED' },
      { id: 'other-driver', userId: 'other-driver', status: 'ACTIVE', reviewStatus: 'APPROVED' }
    ],
    vehicles: [
      { id: 'vehicle', driverId: 'driver', status: 'ACTIVE', reviewStatus: 'APPROVED', type: '七座车', plateMasked: '澳·***28', passengerCapacity: 7 },
      { id: 'other-vehicle', driverId: 'other-driver', status: 'ACTIVE', reviewStatus: 'APPROVED', type: '七座车', plateMasked: '澳·***38', passengerCapacity: 7 }
    ]
  });
  let sequence = 0;
  const service = createPinbaService({
    store,
    clock: () => new Date(NOW),
    idGenerator: () => `phone-${++sequence}`,
    rideDriverAcceptanceEnabled: true
  });
  let request = 0;
  return {
    store,
    call(action, data, actorId, key) {
      request += 1;
      return service.execute({
        action,
        data: data || {},
        requestId: `phone-request-${request}`,
        ...(key ? { idempotencyKey: key } : {})
      }, actorId ? { actorId } : {});
    }
  };
}

test('电话规范只接受澳门、内地和香港受控格式', () => {
  assert.equal(normalizeRidePhone('+853 6123-4567'), '+85361234567');
  assert.equal(normalizeRidePhone('0086 13800138000'), '+8613800138000');
  assert.equal(normalizeRidePhone('+852 9123 4567'), '+85291234567');
  assert.throws(() => normalizeRidePhone('61234567'), (error) => error.code === 'VALIDATION_ERROR');
  assert.throws(() => normalizeRidePhone('+85351234567'), (error) => error.code === 'VALIDATION_ERROR');
});

test('发布者与直接入团乘客电话独立存储且不进入公开活动 DTO', async () => {
  const { store, call } = setup();
  const created = await call('activity.create', rideInput(), 'owner', 'create-phone-1');
  assert.equal(created.ok, true);
  const activityId = created.data.activity.id;
  assert.equal(created.data.activity.contactInfo, undefined);
  assert.equal(store.activities.get(activityId).contactInfo, undefined);
  assert.equal([...store.memberContacts.values()][0].phone, '+85361234567');

  const joined = await call('ride.join', {
    activityId,
    luggageType: 'LARGE',
    phone: '+8613800138000'
  }, 'member', 'join-phone-1');
  assert.equal(joined.ok, true);
  assert.equal(joined.data.activity.contactInfo, undefined);
  assert.equal(store.memberContacts.size, 2);
});

test('只有当前承接司机可读取全部 ACTIVE 成员电话，取消承接后立即失权', async () => {
  const { store, call } = setup();
  const created = await call('activity.create', rideInput(), 'owner', 'create-phone-2');
  const activityId = created.data.activity.id;
  await call('ride.join', { activityId, luggageType: 'LARGE', phone: '+8613800138000' }, 'member', 'join-phone-2');

  const beforeAssign = await call('ride.driver.memberContacts', { activityId }, 'driver');
  assert.equal(beforeAssign.ok, false);
  assert.equal(beforeAssign.error.code, 'FORBIDDEN');

  const accepted = await call('ride.driver.accept', {
    activityId,
    vehicleId: 'vehicle',
    pickupAt: '2026-08-24T10:15:00.000Z'
  }, 'driver', 'accept-phone-2');
  assert.equal(accepted.ok, true);

  const contacts = await call('ride.driver.memberContacts', { activityId }, 'driver');
  assert.equal(contacts.ok, true);
  assert.deepEqual(contacts.data.items.map((item) => [item.nickname, item.phone, item.luggageType]), [
    ['发起者', '+85361234567', 'SMALL'],
    ['乘客甲', '+8613800138000', 'LARGE']
  ]);
  assert.equal(JSON.stringify(accepted.data).includes('+853'), false);

  const otherDriver = await call('ride.driver.memberContacts', { activityId }, 'other-driver');
  assert.equal(otherDriver.ok, false);
  assert.equal(otherDriver.error.code, 'FORBIDDEN');
  const owner = await call('ride.driver.memberContacts', { activityId }, 'owner');
  assert.equal(owner.ok, false);
  assert.equal(owner.error.code, 'FORBIDDEN');

  const cancelled = await call('ride.driver.cancel', { activityId, reason: '车辆临时故障' }, 'driver', 'cancel-phone-2');
  assert.equal(cancelled.ok, true);
  const afterCancel = await call('ride.driver.memberContacts', { activityId }, 'driver');
  assert.equal(afterCancel.ok, false);
  assert.equal(afterCancel.error.code, 'FORBIDDEN');
  assert.equal(store.memberContacts.size, 2);
});

test('任一 ACTIVE 成员缺少联系方式时司机名单整体 fail-closed', async () => {
  const { store, call } = setup();
  const created = await call('activity.create', rideInput(), 'owner', 'create-phone-3');
  const activityId = created.data.activity.id;
  await call('ride.join', { activityId, luggageType: 'NONE', phone: '+85362345678' }, 'member', 'join-phone-3');
  await call('ride.driver.accept', { activityId, vehicleId: 'vehicle', pickupAt: '2026-08-24T10:15:00.000Z' }, 'driver', 'accept-phone-3');
  const memberContact = [...store.memberContacts.values()].find((item) => item.userId === 'member');
  store.memberContacts.delete(memberContact.id);
  const result = await call('ride.driver.memberContacts', { activityId }, 'driver');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'CONTACT_INCOMPLETE');
  assert.equal(result.data, undefined);
});

test('前端电话不会写入发布草稿，联系人名单具备离屏清理与请求竞态保护', () => {
  const root = path.join(__dirname, '../miniprogram');
  const publishScript = fs.readFileSync(path.join(root, 'subpackages/publish/form/index.js'), 'utf8');
  const detailScript = fs.readFileSync(path.join(root, 'subpackages/activity/detail/index.js'), 'utf8');
  const detailTemplate = fs.readFileSync(path.join(root, 'subpackages/activity/detail/index.wxml'), 'utf8');
  const apiScript = fs.readFileSync(path.join(root, 'services/api.js'), 'utf8');
  assert.match(publishScript, /const \{ phoneNumber, \.\.\.safeForm \} = this\.data\.form/);
  assert.match(publishScript, /form:\s*safeForm/);
  assert.doesNotMatch(publishScript, /form:\s*this\.data\.form/);
  assert.match(apiScript, /SENSITIVE_MUTATING_ACTIONS = new Set\(\['driver\.application\.submit', 'activity\.create', 'ride\.join'\]\)/);
  assert.match(detailScript, /_contactsReqSeq/);
  assert.match(detailScript, /onHide\(\)[\s\S]*clearSensitiveContactState/);
  assert.match(detailTemplate, /viewerRole === 'driver'[\s\S]*rideFulfillment\.status === 'ASSIGNED'/);
  assert.match(detailTemplate, /user-select="true"/);
  assert.match(detailTemplate, /bindtap="handleCallMember"/);
});
