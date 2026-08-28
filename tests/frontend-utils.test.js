'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decorateActivity } = require('../miniprogram/utils/display');

function activity(overrides = {}) {
  return {
    id: 'activity-test',
    type: 'ride',
    title: '青茂口岸到凼仔校区',
    district: '澳门校园',
    placeLabel: '青茂口岸 → 凼仔校区',
    startsAt: '2026-08-24T02:00:00.000Z',
    targetMembers: 7,
    minPassengers: 7,
    maxPassengers: 7,
    memberCount: 2,
    status: 'RECRUITING',
    rideJoinable: true,
    driverAcceptable: true,
    rideFulfillment: { status: 'UNASSIGNED' },
    viewerRole: 'guest',
    typeData: { origin: { label: '青茂口岸' }, destination: { label: '凼仔校区' } },
    ...overrides
  };
}

test('活动展示层预计算安全进度和完整读屏文本', () => {
  const decorated = decorateActivity(activity());
  assert.equal(decorated.progressPercent, 29);
  assert.equal(decorated.canApply, true);
  assert.match(decorated.accessibilityLabel, /青茂口岸 → 凼仔校区/);
  assert.match(decorated.accessibilityLabel, /剩余5个座位/);

  const invalidCapacity = decorateActivity(activity({ targetMembers: 0, memberCount: 8 }));
  assert.equal(invalidCapacity.progressPercent, 100);
});

test('已撤回的申请可重新申请，拼车成团后在满员前仍可加入', () => {
  const withdrawn = decorateActivity(activity({
    viewerRole: 'applicant',
    viewerApplication: { status: 'WITHDRAWN' }
  }));
  assert.equal(withdrawn.canApply, true);

  const formed = decorateActivity(activity({
    status: 'FORMED',
    viewerRole: 'applicant',
    viewerApplication: { status: 'CANCELLED_BY_ACTIVITY' }
  }));
  assert.equal(formed.canApply, true);

  const assigned = decorateActivity(activity({
    status: 'FORMED',
    viewerRole: 'applicant',
    viewerApplication: { status: 'CANCELLED_BY_ACTIVITY' },
    rideFulfillment: { status: 'ASSIGNED' }
  }));
  assert.equal(assigned.canApply, true);
});
