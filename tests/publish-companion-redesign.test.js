'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function localDateAfter(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function loadFormDefinition() {
  const formPath = path.join(root, 'subpackages/publish/form/index.js');
  const previousPage = global.Page;
  let definition;
  delete require.cache[require.resolve(formPath)];
  global.Page = (value) => { definition = value; };
  try {
    require(formPath);
  } finally {
    if (previousPage) global.Page = previousPage;
    else delete global.Page;
  }
  return definition;
}

function companionPage(definition, form = {}) {
  return {
    data: {
      ...structuredClone(definition.data),
      type: 'companion',
      form: {
        ...structuredClone(definition.data.form),
        title: '一起去路环',
        originLabel: '澳门大学',
        destinationLabel: '路环市区',
        startDate: localDateAfter(1),
        startTime: '18:30',
        safetyAgreed: true,
        ...form
      },
      safetyAgreed: true
    },
    setData(patch) {
      for (const [key, value] of Object.entries(patch)) {
        if (key.startsWith('form.')) this.data.form[key.slice(5)] = value;
        else this.data[key] = value;
      }
    }
  };
}

test('拼同行定稿使用独立旅行分支且不迁入上传和免审核能力', () => {
  const template = read('subpackages/publish/form/index.wxml');
  const style = read('subpackages/publish/form/index.wxss');

  assert.match(template, /wx:if="\{\{type === 'companion'\}\}"[^>]*class="companion-form-content"/);
  assert.doesNotMatch(template, /wx:if="\{\{type === 'companion'\}\}" class="form-card"/);
  assert.match(template, /\.\/assets\/companion\/companion-travel-frame\.png/);
  ['基本信息', '同行信息', '同行偏好', '时间与人数', '参与规则与安全']
    .forEach((label) => assert.match(template, new RegExp(label), label));
  assert.doesNotMatch(template, /活动图片|上传图片|无需审核|需要审核/);
  assert.doesNotMatch(read('subpackages/publish/form/index.js'), /chooseMedia|uploadFile|requiresApproval|imageUrls/);
  assert.match(style, /\.form-page--companion \.companion-card/);
  assert.match(style, /\.companion-travel-frame\s*\{[^}]*pointer-events:\s*none;[^}]*user-select:\s*none;/s);
});

test('拼同行九组偏好仅在同行分支展示并具有可取消单选语义', () => {
  const template = read('subpackages/publish/form/index.wxml');
  const labels = ['期待拼友性别', 'MBTI 频道', '导航属性', '出行节奏', '拍照习惯', '沉默兼容度', '饭后蒜味', '香水气场', '拖鞋出门'];
  labels.forEach((label) => assert.match(template, new RegExp(label), label));
  assert.match(template, /bindtap="handleCompanionOptionalChoice"/);
  assert.match(template, /role="radio" aria-checked=/);

  const definition = loadFormDefinition();
  const page = companionPage(definition);
  definition.handleCompanionOptionalChoice.call(page, { currentTarget: { dataset: { field: 'travelPace', value: 'RELAXED' } } });
  assert.equal(page.data.form.travelPace, 'RELAXED');
  definition.handleCompanionOptionalChoice.call(page, { currentTarget: { dataset: { field: 'travelPace', value: 'RELAXED' } } });
  assert.equal(page.data.form.travelPace, '');
});

test('拼同行固定与范围拼友数提交时转换为含发起人的总人数', () => {
  const definition = loadFormDefinition();
  const fixed = companionPage(definition, {
    companionMemberMode: 'fixed',
    companionMinFriends: 3,
    companionMaxFriends: 3
  });
  const fixedPayload = definition.buildPayload.call(fixed);
  assert.equal(fixedPayload.minMembers, 4);
  assert.equal(fixedPayload.maxMembers, 4);
  assert.equal(fixedPayload.targetMembers, 4);

  const ranged = companionPage(definition, {
    companionMemberMode: 'range',
    companionMinFriends: 2,
    companionMaxFriends: 5
  });
  const rangePayload = definition.buildPayload.call(ranged);
  assert.equal(rangePayload.minMembers, 3);
  assert.equal(rangePayload.maxMembers, 6);
  assert.equal(rangePayload.targetMembers, 6);

  ranged.data.form.companionMinFriends = 0;
  assert.equal(
    definition.validateForm.call(ranged),
    '拼友人数需在 1—19 位之间（成团总人数 2—20 人）'
  );

  ranged.data.form.companionMinFriends = 5;
  ranged.data.form.companionMaxFriends = 5;
  assert.equal(
    definition.validateForm.call(ranged),
    '拼友人数需在 1—19 位之间（成团总人数 2—20 人）'
  );
});

test('拼同行旧总人数草稿只迁移一次且不影响其他类型字段白名单', () => {
  const definition = loadFormDefinition();
  const previousWx = global.wx;
  global.wx = {
    getStorageSync() {
      return { form: { minMembers: 2, maxMembers: 5, memberRangeText: '2-5', paymentMethod: 'GO_DUTCH' } };
    }
  };
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, patch); }
  };
  try {
    page.onLoad({ type: 'companion' });
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }

  assert.equal(page.data.form.companionMemberMode, 'range');
  assert.equal(page.data.form.companionMinFriends, 1);
  assert.equal(page.data.form.companionMaxFriends, 4);
  assert.equal(Object.hasOwn(page.data.form, 'paymentMethod'), false);
  assert.equal(Object.hasOwn(page.data.form, 'memberRangeText'), false);
});

test('拼同行旧草稿中的基础枚举与九项偏好脏值在前端安全降级', () => {
  const definition = loadFormDefinition();
  const previousWx = global.wx;
  global.wx = {
    getStorageSync() {
      return {
        form: {
          timeFlexibility: 'TEN_MINUTES', transportPreference: 'PRIVATE_CAR', luggageType: 'HUGE',
          friendGenderPreference: 'UNKNOWN', mbtiPreference: 'X', navigationStyle: 'TELEPORT',
          travelPace: 'WARP', photoHabit: 'ALWAYS', silenceComfort: 'NOISE',
          garlicPreference: 'MAYBE', fragrancePreference: 'STRONG', slippersPreference: 'BAREFOOT'
        }
      };
    }
  };
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, patch); }
  };
  try {
    page.onLoad({ type: 'companion' });
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }

  assert.equal(page.data.form.timeFlexibility, 'WITHIN_30_MIN');
  assert.equal(page.data.form.transportPreference, 'DISCUSS_AFTER_FORMED');
  assert.equal(page.data.form.luggageType, 'NONE');
  ['friendGenderPreference', 'mbtiPreference', 'navigationStyle', 'travelPace', 'photoHabit',
    'silenceComfort', 'garlicPreference', 'fragrancePreference', 'slippersPreference']
    .forEach((field) => assert.equal(page.data.form[field], '', field));
});

test('拼运动草稿清洗仍保留自身与通用字段并排除同行和饭桌字段', () => {
  const definition = loadFormDefinition();
  const previousWx = global.wx;
  global.wx = {
    getStorageSync() {
      return {
        form: {
          title: '夜跑搭子', sportType: '跑步', venue: '操场', minMembers: 2, maxMembers: 6,
          companionMinFriends: 8, paymentMethod: 'TABLE_ONLY'
        }
      };
    }
  };
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, patch); }
  };
  try {
    page.onLoad({ type: 'sport' });
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }

  assert.equal(page.data.form.title, '夜跑搭子');
  assert.equal(page.data.form.sportType, '跑步');
  assert.equal(page.data.form.maxMembers, 6);
  assert.equal(Object.hasOwn(page.data.form, 'companionMinFriends'), false);
  assert.equal(Object.hasOwn(page.data.form, 'paymentMethod'), false);
});

test('拼同行 payload 保存真实时间弹性与九项严格偏好，不伪造十分钟结束时间', () => {
  const definition = loadFormDefinition();
  const page = companionPage(definition, {
    startDate: '2099-09-10',
    timeFlexibility: 'WITHIN_30_MIN',
    friendGenderPreference: 'FEMALE',
    mbtiPreference: 'I',
    navigationStyle: 'GUIDE',
    travelPace: 'RELAXED',
    photoHabit: 'CASUAL',
    silenceComfort: 'NATURAL',
    garlicPreference: 'FRESHEN',
    fragrancePreference: 'LIGHT',
    slippersPreference: 'CONTEXT'
  });
  const payload = definition.buildPayload.call(page);

  assert.equal(payload.typeData.timeFlexibility, 'WITHIN_30_MIN');
  assert.equal(payload.startsAt, new Date('2099-09-10T18:30:00').toISOString());
  assert.equal(Object.hasOwn(payload.typeData, 'departureWindowEnd'), false);
  assert.deepEqual(payload.typeData.preferences, {
    friendGender: 'FEMALE',
    mbti: 'I',
    navigationStyle: 'GUIDE',
    travelPace: 'RELAXED',
    photoHabit: 'CASUAL',
    silenceComfort: 'NATURAL',
    garlic: 'FRESHEN',
    fragrance: 'LIGHT',
    slippers: 'CONTEXT'
  });
});

test('三类前端拒绝超过七天的时间且同行切换范围模式时生成有效区间', () => {
  const definition = loadFormDefinition();
  const page = companionPage(definition, { startDate: localDateAfter(8) });
  assert.equal(definition.validateForm.call(page), '活动时间不能超过未来 7 天');

  for (const type of ['sport', 'food']) {
    page.data.type = type;
    assert.equal(definition.validateForm.call(page), '活动时间不能超过未来 7 天');
  }
  const template = read('subpackages/publish/form/index.wxml');
  const datePickers = template.match(/<picker mode="date"[^>]*>/g) || [];
  assert.equal(datePickers.length, 2);
  datePickers.forEach((picker) => {
    assert.match(picker, /start="\{\{minStartDate\}\}"/);
    assert.match(picker, /end="\{\{maxStartDate\}\}"/);
  });
  assert.equal(definition.data.maxStartDate, localDateAfter(6));

  page.data.type = 'companion';
  page.data.form.companionMinFriends = 19;
  page.data.form.companionMaxFriends = 19;
  definition.handleCompanionMemberMode.call(page, { currentTarget: { dataset: { mode: 'range' } } });
  assert.equal(page.data.form.companionMinFriends, 18);
  assert.equal(page.data.form.companionMaxFriends, 19);
});

test('拼同行装饰、输入、窄屏和固定提交栏保留真机防护', () => {
  const template = read('subpackages/publish/form/index.wxml');
  const style = read('subpackages/publish/form/index.wxss');
  const companionBlock = template.match(/<view wx:if="\{\{type === 'companion'\}\}" class="companion-form-content">([\s\S]*?)<\/view>\s*<view wx:else class="form-content/);
  assert.ok(companionBlock, '缺少物理隔离的 companion 内容分支');
  const controls = companionBlock[1].match(/<(?:input|textarea)\b[^>]*>/g) || [];
  assert.ok(controls.length > 0);
  controls.forEach((control) => {
    assert.match(control, /adjust-position="true"/);
    assert.match(control, /cursor-spacing="140"/);
  });
  assert.match(style, /\.form-page--companion\s*\{[^}]*padding-bottom:\s*calc\(210rpx \+ env\(safe-area-inset-bottom\)\)/s);
  assert.match(style, /@media \(max-width:\s*340px\)[\s\S]*\.companion-form-content/);
  assert.match(template, /wx:if="\{\{type === 'companion'\}\}" class="fixed-submit-bar fixed-submit-bar--companion"/);
  assert.match(template, /wx:else class="fixed-submit-bar \{\{type === 'food' \? 'fixed-submit-bar--food' : ''\}\}"/);
});
