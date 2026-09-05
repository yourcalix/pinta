'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mockServer = require('../miniprogram/mocks/server');
const { validateActivityInput } = require('../cloudfunctions/api/lib/validation');

function activityInput(type, overrides = {}) {
  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const deadlineAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const typeData = {
    companion: {
      originLabel: '关闸', destinationLabel: '氹仔', timeFlexibility: 'WITHIN_30_MIN',
      transportPreference: 'DISCUSS_AFTER_FORMED', luggageType: 'NONE'
    },
    sport: {
      sportType: '羽毛球', venue: '附近体育馆', level: 'ANY', intensity: 'MEDIUM', equipment: ''
    },
    food: {
      venue: '附近餐厅', cuisine: '粤菜', budgetRange: '50以内', dietaryNotes: ''
    }
  };
  return {
    type,
    title: '周末一起活动',
    description: '',
    city: '澳门',
    district: '澳门城区',
    placeLabel: type === 'companion' ? '关闸 → 氹仔' : typeData[type].venue,
    startsAt,
    deadlineAt,
    minMembers: 2,
    maxMembers: 4,
    targetMembers: 4,
    rules: '',
    typeData: typeData[type],
    ...overrides
  };
}

async function mockCreate(input, key) {
  return mockServer.call({
    action: 'activity.create',
    data: input,
    requestId: `publish-validation-${key}`,
    idempotencyKey: `publish-validation-${key}`
  });
}

test('三类活动均允许不填写补充说明，并与正式校验契约一致', async (t) => {
  mockServer.reset();
  t.after(() => mockServer.reset());

  for (const type of ['companion', 'sport', 'food']) {
    const input = activityInput(type);
    assert.equal(validateActivityInput(input).description, '');
    const result = await mockCreate(input, `empty-${type}`);
    assert.equal(result.ok, true, `${type} 应允许空补充说明`);
    assert.equal(result.data.activity.description, '');
  }
});

test('Mock 创建活动会规范化标题和补充说明空白', async (t) => {
  mockServer.reset();
  t.after(() => mockServer.reset());

  const result = await mockCreate(activityInput('sport', {
    title: '  周末打球  ',
    description: '   '
  }), 'trim');
  assert.equal(result.ok, true);
  assert.equal(result.data.activity.title, '周末打球');
  assert.equal(result.data.activity.description, '');
});

test('Mock 与正式后端共享标题30字和补充说明300字上限', async (t) => {
  mockServer.reset();
  t.after(() => mockServer.reset());

  const boundary = await mockCreate(activityInput('food', {
    title: '标'.repeat(30),
    description: '说'.repeat(300)
  }), 'boundary');
  assert.equal(boundary.ok, true);

  const longTitle = activityInput('food', { title: '标'.repeat(31) });
  assert.throws(() => validateActivityInput(longTitle), (error) => error.code === 'VALIDATION_ERROR');
  const titleResult = await mockCreate(longTitle, 'long-title');
  assert.equal(titleResult.ok, false);
  assert.equal(titleResult.error.code, 'VALIDATION_ERROR');
  assert.equal(titleResult.error.message, '标题长度不能超过30个字符');

  const longDescription = activityInput('food', { description: '说'.repeat(301) });
  assert.throws(() => validateActivityInput(longDescription), (error) => error.code === 'VALIDATION_ERROR');
  const descriptionResult = await mockCreate(longDescription, 'long-description');
  assert.equal(descriptionResult.ok, false);
  assert.equal(descriptionResult.error.code, 'VALIDATION_ERROR');
  assert.equal(descriptionResult.error.message, '补充说明长度不能超过300个字符');
});
