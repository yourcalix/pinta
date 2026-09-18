'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mockServer = require('../miniprogram/mocks/server');
const { validateActivityInput } = require('../cloudfunctions/api/lib/validation');
const { publicActivity } = require('../cloudfunctions/api/lib/service');

const root = path.join(__dirname, '../miniprogram');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function benefitInput(overrides = {}) {
  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  return {
    type: 'benefit',
    title: '一起凑满减',
    description: '官方渠道下单，成团后在成员空间核对规则',
    city: '澳门',
    district: '澳门校园',
    placeLabel: '山姆会员店',
    startsAt,
    deadlineAt: new Date(Date.parse(startsAt) - 30 * 60 * 1000).toISOString(),
    minMembers: 2,
    maxMembers: 4,
    targetMembers: 4,
    rules: '平台不代收款',
    typeData: {
      merchantOrPlatform: '山姆会员店',
      dealType: 'FULL_REDUCTION',
      offerThreshold: '满 200 减 50',
      targetPrice: '约 MOP 60/人',
      estimatedSaving: '约省 MOP 25/人',
      fulfillmentType: 'ONLINE',
      details: '仅限官方渠道，优惠以结算页为准'
    },
    ...overrides
  };
}

function meetingPoint() {
  return {
    label: '氹仔线下门店', address: '澳门氹仔某商场一层', latitude: 22.1536, longitude: 113.5564,
    province: '澳门特别行政区', city: '澳门', district: '澳门校园', adcode: '820000',
    coordinateSystem: 'GCJ02', provider: 'AMAP', poiId: 'benefit-offline-poi'
  };
}

function localDateAfter(days) {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + days);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function loadFormDefinition() {
  const formPath = path.join(root, 'subpackages/publish/form/index.js');
  const previousPage = global.Page;
  let definition;
  delete require.cache[require.resolve(formPath)];
  global.Page = (value) => { definition = value; };
  try { require(formPath); } finally {
    if (previousPage) global.Page = previousPage;
    else delete global.Page;
  }
  return definition;
}

test('拼享惠使用独立严格契约且公开 DTO 不泄露未知字段', () => {
  const value = validateActivityInput(benefitInput({
    typeData: { ...benefitInput().typeData, internalContact: 'wx-secret' }
  }));
  assert.deepEqual(value.typeData, benefitInput().typeData);
  const dto = publicActivity({
    ...value,
    id: 'benefit-1', ownerId: 'owner', owner: { nickname: '发起人' },
    memberCount: 1, status: 'RECRUITING', version: 1
  });
  assert.equal(dto.type, 'benefit');
  assert.equal(dto.typeData.merchantOrPlatform, '山姆会员店');
  assert.equal(Object.hasOwn(dto.typeData, 'internalContact'), false);
});

test('拼享惠旧数据在公开 DTO 中安全降级并严格白名单输出', () => {
  const dto = publicActivity({
    ...benefitInput(),
    id: 'benefit-legacy', ownerId: 'owner', owner: { nickname: '发起人' },
    memberCount: 1, status: 'RECRUITING', version: 1,
    typeData: {
      merchantOrPlatform: '旧商家', dealType: 'UNKNOWN_DEAL', fulfillmentType: 'UNKNOWN_MODE',
      offerThreshold: 200, targetPrice: null, estimatedSaving: {}, details: ['legacy'], secret: 'do-not-expose'
    }
  });
  assert.deepEqual(dto.typeData, {
    merchantOrPlatform: '旧商家', dealType: 'OTHER', offerThreshold: '', targetPrice: '',
    estimatedSaving: '', fulfillmentType: 'ONLINE', details: ''
  });
  assert.equal(Object.hasOwn(dto.typeData, 'secret'), false);
});

test('拼享惠拒绝非法枚举并只在线下到店时要求高德地点', () => {
  assert.throws(() => validateActivityInput(benefitInput({
    typeData: { ...benefitInput().typeData, dealType: 'FOOD_PAYMENT' }
  })), (error) => error.code === 'VALIDATION_ERROR');
  assert.throws(() => validateActivityInput(benefitInput({
    typeData: { ...benefitInput().typeData, fulfillmentType: 'OFFLINE' }
  })), (error) => error.code === 'VALIDATION_ERROR');
  assert.equal(validateActivityInput(benefitInput()).meetingPoint, undefined);
});

test('线下拼享惠进入附近列表，线上模式强制丢弃残留坐标', async (t) => {
  mockServer.reset();
  t.after(() => mockServer.reset());
  const input = benefitInput({
    placeLabel: '客户端旧文案', meetingPoint: meetingPoint(),
    typeData: { ...benefitInput().typeData, fulfillmentType: 'OFFLINE', internalContact: 'wx-secret' }
  });
  const value = validateActivityInput(input);
  assert.equal(value.placeLabel, meetingPoint().label);
  const cloudDto = publicActivity({
    ...value, id: 'benefit-offline-cloud', ownerId: 'owner', owner: { nickname: '发起人' },
    memberCount: 1, status: 'RECRUITING', version: 1
  });
  assert.deepEqual(cloudDto.meetingPoint, { label: meetingPoint().label, address: meetingPoint().address });
  assert.equal('latitude' in cloudDto.meetingPoint, false);

  const created = await mockServer.call({
    action: 'activity.create', data: input, requestId: 'benefit-offline-create', idempotencyKey: 'benefit-offline-create-key'
  });
  assert.equal(created.ok, true);
  assert.equal(created.data.activity.placeLabel, meetingPoint().label);
  assert.equal(Object.hasOwn(created.data.activity.typeData, 'internalContact'), false);
  assert.deepEqual(created.data.activity.meetingPoint, { label: meetingPoint().label, address: meetingPoint().address });
  const onlineInput = benefitInput({ placeLabel: '客户端旧地点', meetingPoint: { legacyMalformedPoint: true } });
  const onlineValue = validateActivityInput(onlineInput);
  assert.equal(onlineValue.meetingPoint, undefined);
  assert.equal(onlineValue.placeLabel, '山姆会员店');
  const online = await mockServer.call({
    action: 'activity.create', data: onlineInput, requestId: 'benefit-online-create', idempotencyKey: 'benefit-online-create-key'
  });
  assert.equal(online.ok, true);
  assert.equal(online.data.activity.meetingPoint, undefined);
  assert.equal(online.data.activity.placeLabel, '山姆会员店');
  const nearby = await mockServer.call({
    action: 'activity.nearby', requestId: 'benefit-offline-nearby',
    data: { latitude: meetingPoint().latitude, longitude: meetingPoint().longitude, coordinateSystem: 'GCJ02', radiusMeters: 1000, type: 'benefit', limit: 10 }
  });
  assert.equal(nearby.ok, true);
  assert.deepEqual(nearby.data.items.map((item) => item.id), [created.data.activity.id]);
});

test('拼享惠前端对草稿绕过 maxlength 的字段执行与后端一致的长度校验', () => {
  const definition = loadFormDefinition();
  const form = {
    ...structuredClone(definition.data.form), title: '一起凑满减', merchantOrPlatform: '商'.repeat(51),
    offerThreshold: '满 200 减 50', fulfillmentType: 'ONLINE', startDate: localDateAfter(1), startTime: '18:30',
    minMembers: 2, maxMembers: 4
  };
  const page = { data: { ...structuredClone(definition.data), type: 'benefit', form, safetyAgreed: true } };
  assert.equal(definition.validateForm.call(page), '商家或平台名称不能超过 50 个字');
  page.data.form.merchantOrPlatform = '山姆会员店';
  page.data.form.offerThreshold = '惠'.repeat(81);
  assert.equal(definition.validateForm.call(page), '优惠门槛不能超过 80 个字');
});

test('拼享惠发布表单生成独立 DTO 且不含外部联系方式与饭桌字段', () => {
  const definition = loadFormDefinition();
  const form = {
    ...structuredClone(definition.data.form),
    title: '一起凑满减', merchantOrPlatform: '山姆会员店', dealType: 'FULL_REDUCTION',
    offerThreshold: '满 200 减 50', targetPrice: '约 MOP 60/人', estimatedSaving: '约省 MOP 25/人',
    fulfillmentType: 'ONLINE', details: '官方渠道下单', startDate: '2099-09-10', startTime: '18:30',
    minMembers: 2, maxMembers: 4, meetingPoint: meetingPoint(), contactMethod: 'should-not-exist'
  };
  const payload = definition.buildPayload.call({ data: { ...definition.data, type: 'benefit', form } });
  assert.equal(payload.type, 'benefit');
  assert.deepEqual(payload.typeData, {
    merchantOrPlatform: '山姆会员店', dealType: 'FULL_REDUCTION', offerThreshold: '满 200 减 50',
    targetPrice: '约 MOP 60/人', estimatedSaving: '约省 MOP 25/人', fulfillmentType: 'ONLINE', details: '官方渠道下单'
  });
  assert.equal('contactMethod' in payload.typeData, false);
  assert.equal('meetingPoint' in payload, false);
  ['cuisine', 'dietaryNotes', 'paymentMethod'].forEach((field) => assert.equal(field in payload.typeData, false));
});

test('拼享惠视觉分支保持独立、无联系方式，并具备键盘安全区与本地素材', () => {
  const template = read('subpackages/publish/form/index.wxml');
  const style = read('subpackages/publish/form/index.wxss');
  const script = read('subpackages/publish/form/index.js');
  assert.match(template, /wx:elif="\{\{type === 'benefit'\}\}"[^>]*class="benefit-form-content"/);
  assert.match(script, /线上拼单/);
  assert.match(script, /线下到店/);
  assert.match(template, /立即发布拼享惠/);
  assert.doesNotMatch(template, /手机号|微信号|联系方式|二维码/);
  assert.match(style, /\.form-page--benefit \.benefit-card/);
  assert.match(style, /@media \(max-width:\s*340px\)[\s\S]*\.benefit-price-grid/);
  assert.match(template, /\/assets\/images\/publish\/publish-cover-benefit\.png/);
  ['icon-bag.png', 'decor-pig.png', 'decor-discount.png']
    .forEach((file) => assert.equal(fs.existsSync(path.join(root, 'subpackages/publish/form/assets/benefit', file)), true, file));
});
