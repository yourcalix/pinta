'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('拼饭桌新界面隔离在 food 条件分支且保留另外两类发布表单', () => {
  const template = read('subpackages/publish/form/index.wxml');
  const foodBranch = template.slice(template.indexOf('food-form-content'), template.indexOf('<view wx:else class="form-content">'));
  const sharedBranch = template.slice(template.indexOf('<view wx:else class="form-content">'));

  assert.match(template, /wx:if="\{\{type === 'food'\}\}" class="form-content food-form-content"/);
  assert.match(sharedBranch, /type === 'companion'/);
  assert.match(sharedBranch, /section-title--sport/);
  assert.doesNotMatch(sharedBranch, /food-paper-card/);
  assert.match(foodBranch, /写下这桌的邀请/);
  assert.match(foodBranch, /想吃什么，去哪里/);
  assert.match(foodBranch, /约好时间与人数/);
  assert.match(foodBranch, /饭桌约定与安全/);
});

test('拼饭桌视觉层只绑定现有真实表单字段与处理器', () => {
  const template = read('subpackages/publish/form/index.wxml');
  const foodBranch = template.slice(template.indexOf('food-form-content'), template.indexOf('<view wx:else class="form-content">'));
  const requiredFields = [
    'title', 'description', 'venue', 'cuisine', 'budgetRange', 'dietaryNotes',
    'startDate', 'startTime', 'minMembers', 'maxMembers', 'rules'
  ];

  requiredFields.forEach((field) => assert.match(foodBranch, new RegExp(`form\\.${field}`), field));
  assert.match(foodBranch, /bindinput="handleInput"/);
  assert.match(foodBranch, /bindinput="handleNumber"/);
  assert.match(foodBranch, /bindchange="handleDate"/);
  assert.match(foodBranch, /bindchange="handleTime"/);
  assert.match(foodBranch, /bindchange="handleSafety"/);
  assert.doesNotMatch(foodBranch, /paymentMethod|genderPreference|mbtiPreference|chooseLocation|dietaryCustom/);
});

test('拼饭桌素材位于发布分包且全部使用 iPhone 稳定格式', () => {
  const files = [
    'food-paper-bg.jpg',
    'food-paper-edge-top.png',
    'food-paper-edge-bottom.png',
    'food-hotpot.png',
    'food-sushi.png',
    'food-picnic.png'
  ];
  let totalBytes = 0;

  files.forEach((file) => {
    const fullPath = path.join(root, 'subpackages/publish/form/assets/food', file);
    assert.equal(fs.existsSync(fullPath), true, file);
    const buffer = fs.readFileSync(fullPath);
    totalBytes += buffer.length;
    assert.ok(/\.(?:png|jpe?g)$/i.test(file), file);
  });

  assert.ok(totalBytes < 700 * 1024, `拼饭桌素材总大小 ${totalBytes} 应小于 700KB`);
});

test('撕边只使用固定高度切片且所有装饰图不拦截输入触控', () => {
  const template = read('subpackages/publish/form/index.wxml');
  const style = read('subpackages/publish/form/index.wxss');

  assert.doesNotMatch(template, /food-paper-card\.png/);
  assert.equal((template.match(/food-paper-edge-top\.png/g) || []).length, 4);
  assert.equal((template.match(/food-paper-edge-bottom\.png/g) || []).length, 4);
  assert.match(style, /\.food-paper-edge\s*\{[^}]*height:\s*44rpx;[^}]*pointer-events:\s*none;[^}]*user-select:\s*none;/s);
  assert.match(style, /\.food-hero-image\s*\{[^}]*pointer-events:\s*none;[^}]*user-select:\s*none;/s);
  assert.match(style, /\.food-section-illustration\s*\{[^}]*pointer-events:\s*none;[^}]*user-select:\s*none;/s);
});

test('拼饭桌输入区与固定提交区保留键盘及安全区防护', () => {
  const template = read('subpackages/publish/form/index.wxml');
  const style = read('subpackages/publish/form/index.wxss');
  const foodBranch = template.slice(template.indexOf('food-form-content'), template.indexOf('<view wx:else class="form-content">'));

  assert.match(foodBranch, /adjust-position="true"/);
  assert.match(foodBranch, /cursor-spacing="140"/);
  assert.match(template, /fixed-submit-bar--food/);
  assert.match(style, /\.form-page--food\s*\{[^}]*padding-bottom:\s*calc\(190rpx \+ env\(safe-area-inset-bottom\)\)/s);
  assert.match(style, /\.fixed-submit-bar--food\s*\{/);
  assert.match(style, /@media \(max-width:\s*340px\)[\s\S]*\.food-form-content/);
});
