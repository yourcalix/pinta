'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

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

test('拼饭桌原稿保留既有视觉文案并与另外两类表单保持条件隔离', () => {
  const template = read('subpackages/publish/form/index.wxml');

  assert.match(template, /class="form-content \{\{type === 'food' \? 'food-form-content' : ''\}\}"/);
  assert.match(template, /wx:if="\{\{type !== 'food'\}\}" class="form-card"/);
  assert.match(template, /type === 'companion'/);
  assert.match(template, /section-title--sport/);
  ['饭桌信息', '餐厅或饭店', '拼桌形式', '饮食偏好（选填）', '时间与人数', '饭友性别偏好', '希望的MBTI类型']
    .forEach((label) => assert.match(template, new RegExp(label), label));
  assert.match(template, /\.\/assets\/food\/pin_food_interface\.jpg/);
  assert.match(template, /fapiao\.png/);
});

test('拼饭桌当前可见输入被确定性适配为真实活动 DTO', () => {
  const definition = loadFormDefinition();
  const page = {
    data: {
      ...definition.data,
      type: 'food',
      form: {
        ...definition.data.form,
        venue: '学生餐厅',
        cuisine: '粤菜',
        budgetRange: '¥50-80/人',
        dietaryNotes: '不吃香菜,不能吃辣',
        dietaryCustom: '花生过敏',
        paymentMethod: 'Fifty Fifty (均摊)',
        genderPreference: '男生',
        mbtiPreference: 'ENFP',
        startDate: '2099-09-10',
        startTime: '18:30',
        minMembers: 2,
        memberRangeText: '2-5',
        rules: '请守时'
      }
    }
  };

  const payload = definition.buildPayload.call(page);
  assert.equal(payload.title, '粤菜拼桌 · 学生餐厅');
  assert.match(payload.description, /学生餐厅/);
  assert.equal(payload.minMembers, 2);
  assert.equal(payload.maxMembers, 5);
  assert.equal(payload.targetMembers, 5);
  assert.deepEqual(payload.typeData, {
    venue: '学生餐厅',
    cuisine: '粤菜',
    budgetRange: '¥50-80/人',
    dietaryNotes: '不吃香菜、不能吃辣、花生过敏',
    paymentMethod: 'FIFTY_FIFTY',
    genderPreference: 'MALE',
    mbtiPreference: 'ENFP'
  });
});

test('拼饭桌旧草稿迁移人数范围并恢复各选择器索引', () => {
  const definition = loadFormDefinition();
  const previousWx = global.wx;
  global.wx = {
    getStorageSync() {
      return {
        form: {
          minMembers: 2,
          maxMembers: 5,
          cuisine: '火锅',
          budgetRange: '¥50-80/人',
          paymentMethod: 'Go Dutch (AA)',
          genderPreference: '男女均可',
          mbtiPreference: 'ENFP'
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
    page.onLoad({ type: 'food' });
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }

  assert.equal(page.data.form.memberRangeText, '2-5');
  assert.equal(page.data.cuisineIndex, 1);
  assert.equal(page.data.budgetIndex, 3);
  assert.equal(page.data.paymentIndex, 1);
  assert.equal(page.data.genderIndex, 3);
  assert.equal(page.data.mbtiIndex, 8);
  assert.equal(page.data.cuisineImage, './assets/food/pin_htht.jpg');
});

test('拼饭桌确定性标题在超长餐厅和菜系下仍满足服务端长度上限', () => {
  const definition = loadFormDefinition();
  const page = {
    data: {
      ...definition.data,
      type: 'food',
      form: {
        ...definition.data.form,
        venue: '很长的餐厅名称'.repeat(10),
        cuisine: '融合菜系'.repeat(10),
        minMembers: 2,
        memberRangeText: '2-5'
      }
    }
  };

  const payload = definition.buildPayload.call(page);
  assert.ok(Array.from(payload.title).length >= 2);
  assert.ok(Array.from(payload.title).length <= 30);
});

test('拼饭桌实际引用素材均位于小程序包且使用 iPhone 稳定格式', () => {
  const files = [
    'pin_food_interface.jpg', 'pin_food.png', 'fapiao.png', 'hotpot.png', 'sushi.png',
    'breakfast.png', 'barbecue.png', 'burger.png', 'picnic.png', 'yuecai.jpg', 'pin_htht.jpg'
  ];

  files.forEach((file) => {
    const fullPath = path.join(root, 'subpackages/publish/form/assets/food', file);
    assert.equal(fs.existsSync(fullPath), true, file);
    assert.ok(/\.(?:png|jpe?g)$/i.test(file), file);
  });
});

test('拼饭桌整纸视觉例外保持原稿且所有装饰图不拦截输入触控', () => {
  const template = read('subpackages/publish/form/index.wxml');
  const style = read('subpackages/publish/form/index.wxss');

  assert.match(template, /class="form-paper-background"[^>]*\.\/assets\/food\/pin_food_interface\.jpg/);
  assert.equal((template.match(/class="form-card-bg"/g) || []).length, 2);
  assert.match(style, /\.type-intro-mark,[\s\S]*\.form-card-bg\s*\{[\s\S]*pointer-events:\s*none;[\s\S]*user-select:\s*none;/);
});

test('拼饭桌输入区与固定提交区保留键盘及安全区防护', () => {
  const template = read('subpackages/publish/form/index.wxml');
  const style = read('subpackages/publish/form/index.wxss');
  const textControls = template.match(/<(?:input|textarea)\b[^>]*>/g) || [];

  assert.ok(textControls.length > 0);
  textControls.forEach((control) => {
    assert.match(control, /adjust-position="true"/);
    assert.match(control, /cursor-spacing="140"/);
  });
  assert.match(template, /fixed-submit-bar \{\{type === 'food' \? 'fixed-submit-bar--food' : ''\}\}/);
  assert.match(style, /\.form-page--food\s*\{[^}]*padding-bottom:\s*calc\(190rpx \+ env\(safe-area-inset-bottom\)\)/s);
  assert.match(style, /@media \(max-width:\s*340px\)[\s\S]*\.food-form-content/);
});
