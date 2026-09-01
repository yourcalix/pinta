'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decorateActivity } = require('../miniprogram/utils/display');
const { sanitizeUserFacingMessage } = require('../miniprogram/services/api');

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
    canJoinRide: true,
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

test('统一错误出口移除旧服务端返回的地域字样', () => {
  assert.equal(sanitizeUserFacingMessage('当前仅支持澳门试点'), '当前仅支持校园试点');
  assert.equal(sanitizeUserFacingMessage('澳门校园服务暂不可用'), '校园服务暂不可用');
  assert.equal(sanitizeUserFacingMessage('请联系澳門客服'), '请联系客服');
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

test('拼车加入契约缺失时保持 fail-closed 并提示服务更新', () => {
  const legacyResponse = decorateActivity(activity({ canJoinRide: undefined }));
  assert.equal(legacyResponse.canApply, false);
  assert.equal(legacyResponse.joinUnavailableTip, '服务更新中，请刷新后重试');

  const explicitDenial = decorateActivity(activity({
    canJoinRide: false,
    joinUnavailableReason: '行程已满员'
  }));
  assert.equal(explicitDenial.canApply, false);
  assert.equal(explicitDenial.joinUnavailableTip, '行程已满员');
});

test('拼车终态和异常状态优先于人数徽标，不得回退为招募中', () => {
  const expected = {
    CANCELLED: '已取消',
    EXPIRED: '已过期',
    COMPLETED: '已完成',
    IN_PROGRESS: '进行中',
    SUSPENDED: '已下架'
  };
  Object.entries(expected).forEach(([status, label]) => {
    const decorated = decorateActivity(activity({ status, memberCount: 1 }));
    assert.equal(decorated.statusLabel, label);
    assert.notEqual(decorated.statusLabel, '招募中');
  });
});
