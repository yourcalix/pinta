'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mockServer = require('../miniprogram/mocks/server');
const { validateActivityInput } = require('../cloudfunctions/api/lib/validation');
const { publicActivity } = require('../cloudfunctions/api/lib/service');

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

test('三类活动在 Cloud 与 Mock 中统一拒绝超过未来七天的开始时间', async (t) => {
  mockServer.reset();
  t.after(() => mockServer.reset());

  for (const type of ['companion', 'sport', 'food']) {
    const input = activityInput(type, {
      startsAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString()
    });
    assert.throws(() => validateActivityInput(input), (error) => error.code === 'VALIDATION_ERROR');
    const result = await mockCreate(input, `future-limit-${type}`);
    assert.equal(result.ok, false, `${type} Mock 应拒绝超过七天的开始时间`);
    assert.equal(result.error.code, 'VALIDATION_ERROR');
    assert.equal(result.error.message, '活动开始时间不能超过7天');
  }
});

test('拼同行九项偏好在正式校验与 Mock 创建中保持严格同构', async (t) => {
  mockServer.reset();
  t.after(() => mockServer.reset());
  const preferences = {
    friendGender: 'FEMALE',
    mbti: 'I',
    navigationStyle: 'GUIDE',
    travelPace: 'RELAXED',
    photoHabit: 'CASUAL',
    silenceComfort: 'NATURAL',
    garlic: 'FRESHEN',
    fragrance: 'LIGHT',
    slippers: 'CONTEXT'
  };
  const input = activityInput('companion', {
    typeData: { ...activityInput('companion').typeData, preferences }
  });

  assert.deepEqual(validateActivityInput(input).typeData.preferences, preferences);
  const result = await mockCreate(input, 'companion-preferences');
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.activity.typeData.preferences, preferences);
});

test('拼同行偏好缺省兼容旧客户端，未知枚举在 Cloud 与 Mock 均拒绝', async (t) => {
  mockServer.reset();
  t.after(() => mockServer.reset());
  const emptyPreferences = {
    friendGender: '', mbti: '', navigationStyle: '', travelPace: '', photoHabit: '',
    silenceComfort: '', garlic: '', fragrance: '', slippers: ''
  };
  assert.deepEqual(validateActivityInput(activityInput('companion')).typeData.preferences, emptyPreferences);

  const invalid = activityInput('companion', {
    typeData: {
      ...activityInput('companion').typeData,
      preferences: { travelPace: 'UNKNOWN' }
    }
  });
  assert.throws(() => validateActivityInput(invalid), (error) => error.code === 'VALIDATION_ERROR');
  const result = await mockCreate(invalid, 'invalid-companion-preference');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'VALIDATION_ERROR');
  assert.equal(result.error.message, '出行节奏偏好选项无效');
});

test('拼同行公开 DTO 对历史基础枚举与偏好脏值执行白名单降级', () => {
  const dto = publicActivity({
    ...activityInput('companion'),
    id: 'legacy-companion',
    memberCount: 1,
    status: 'RECRUITING',
    typeData: {
      originLabel: '关闸',
      destinationLabel: '氹仔',
      timeFlexibility: 'UNKNOWN',
      transportPreference: 'UNKNOWN',
      luggageType: 'UNKNOWN',
      preferences: { travelPace: 'UNKNOWN', photoHabit: 'CASUAL', internalNote: 'hidden' }
    }
  });

  assert.equal(dto.typeData.timeFlexibility, 'ON_TIME');
  assert.equal(dto.typeData.transportPreference, 'DISCUSS_AFTER_FORMED');
  assert.equal(dto.typeData.luggageType, 'NONE');
  assert.equal(dto.typeData.preferences.travelPace, '');
  assert.equal(dto.typeData.preferences.photoHabit, 'CASUAL');
  assert.equal(Object.hasOwn(dto.typeData.preferences, 'internalNote'), false);
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

test('拼饭桌扩展字段在正式校验与 Mock 创建中保持同构', async (t) => {
  mockServer.reset();
  t.after(() => mockServer.reset());

  const input = activityInput('food', {
    typeData: {
      venue: '  学生餐厅  ',
      cuisine: ' 粤菜 ',
      budgetRange: '',
      dietaryNotes: '  不吃香菜、花生过敏  ',
      paymentMethod: 'GO_DUTCH',
      genderPreference: 'ALL',
      mbtiPreference: 'ENFP'
    }
  });
  const expected = {
    venue: '学生餐厅',
    cuisine: '粤菜',
    budgetRange: '',
    dietaryNotes: '不吃香菜、花生过敏',
    paymentMethod: 'GO_DUTCH',
    genderPreference: 'ALL',
    mbtiPreference: 'ENFP'
  };

  assert.deepEqual(validateActivityInput(input).typeData, expected);
  const result = await mockCreate(input, 'food-expanded-fields');
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.activity.typeData, expected);
});

test('旧拼饭桌客户端缺少扩展字段时按均摊语义兼容', () => {
  const value = validateActivityInput(activityInput('food'));
  assert.equal(value.typeData.paymentMethod, 'FIFTY_FIFTY');
  assert.equal(value.typeData.genderPreference, '');
  assert.equal(value.typeData.mbtiPreference, '');
});

test('拼饭桌仅对缺省拼桌形式兼容，显式空值在 Cloud 与 Mock 均拒绝', async (t) => {
  mockServer.reset();
  t.after(() => mockServer.reset());
  const input = activityInput('food', {
    typeData: {
      venue: '附近餐厅', cuisine: '粤菜', budgetRange: '50以内', dietaryNotes: '',
      paymentMethod: '', genderPreference: '', mbtiPreference: ''
    }
  });

  assert.throws(() => validateActivityInput(input), (error) => error.code === 'VALIDATION_ERROR');
  const result = await mockCreate(input, 'empty-payment-method');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'VALIDATION_ERROR');
  assert.equal(result.error.message, '拼桌形式选项无效');
});

test('拼饭桌扩展字段拒绝未知枚举并按支付方式校验预算', () => {
  const invalidPreference = activityInput('food', {
    typeData: {
      venue: '附近餐厅', cuisine: '粤菜', budgetRange: '50以内', dietaryNotes: '',
      paymentMethod: 'GO_DUTCH', genderPreference: 'UNKNOWN', mbtiPreference: ''
    }
  });
  assert.throws(() => validateActivityInput(invalidPreference), (error) => error.code === 'VALIDATION_ERROR');

  const missingSharedBudget = activityInput('food', {
    typeData: {
      venue: '附近餐厅', cuisine: '粤菜', budgetRange: '', dietaryNotes: '',
      paymentMethod: 'FIFTY_FIFTY', genderPreference: '', mbtiPreference: ''
    }
  });
  assert.throws(() => validateActivityInput(missingSharedBudget), (error) => error.code === 'VALIDATION_ERROR');
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
