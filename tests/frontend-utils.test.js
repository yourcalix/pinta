'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decorateActivity } = require('../miniprogram/utils/display');

function activity(overrides = {}) {
  return {
    id: 'activity-test',
    type: 'ride',
    title: '张江到浦东机场同行',
    district: '浦东新区',
    placeLabel: '张江地铁站',
    startsAt: '2026-08-24T02:00:00.000Z',
    targetMembers: 4,
    memberCount: 2,
    status: 'RECRUITING',
    viewerRole: 'guest',
    typeData: { origin: '张江', destination: '浦东机场' },
    ...overrides
  };
}

test('活动展示层预计算安全进度和完整读屏文本', () => {
  const decorated = decorateActivity(activity());
  assert.equal(decorated.progressPercent, 50);
  assert.equal(decorated.canApply, true);
  assert.match(decorated.accessibilityLabel, /浦东新区 张江地铁站/);
  assert.match(decorated.accessibilityLabel, /还差2人/);

  const invalidCapacity = decorateActivity(activity({ targetMembers: 0, memberCount: 8 }));
  assert.equal(invalidCapacity.progressPercent, 100);
});

test('已撤回或被活动关闭的申请在仍招募时可以重新申请', () => {
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
  assert.equal(formed.canApply, false);
});
