'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../miniprogram/pages/user');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

test('我的页面采用沉浸式个人背景与白色圆角活动面板', () => {
  const template = read('index.wxml');
  const style = read('index.wxss');

  assert.match(template, /^<view class="page user-page global-background-host">/);
  assert.doesNotMatch(template, /^<view class="page user-page global-background-host"[^>]*padding-top/);
  assert.match(template, /class="profile-stage"[^>]*style="padding-top: \{\{contentTopInset\}\}px;"/);
  assert.match(template, /class="page-state-layer"[^>]*style="margin-top: \{\{contentTopInset\}\}px;"/);
  assert.match(template, /class="profile-atmosphere-image"[^>]*src="\{\{profileAvatarPath\}\}"[^>]*mode="aspectFill"[^>]*aria-hidden="true"/);
  assert.match(template, /class="profile-atmosphere-shade"/);
  assert.match(template, /class="profile-content-sheet"/);
  assert.match(style, /\.profile-stage\s*{[\s\S]*min-height:\s*560rpx/);
  assert.match(style, /\.profile-content-sheet\s*{[\s\S]*margin-top:\s*-40rpx[\s\S]*border-radius:\s*36rpx 36rpx 0 0/);
  assert.match(style, /\.user-page\s*{[\s\S]*width:\s*100vw[\s\S]*padding-right:\s*0[\s\S]*padding-left:\s*0/);
  assert.match(style, /\.profile-stage\s*{[\s\S]*width:\s*100vw/);
  assert.match(style, /\.profile-content-sheet\s*{[\s\S]*width:\s*100vw[\s\S]*margin-right:\s*0[\s\S]*margin-left:\s*0/);
  assert.match(style, /filter:\s*blur\(35px\)/);
  assert.doesNotMatch(style, /backdrop-filter/);
});

test('个人资料、统计、待办和四类活动入口保留真实业务语义', () => {
  const template = read('index.wxml');
  const script = read('index.js');
  const style = read('index.wxss');

  assert.match(template, /aria-label="编辑个人资料"/);
  assert.match(template, /class="profile-edit-surface"/);
  assert.match(style, /\.profile-action-row\s*{[\s\S]*position:\s*absolute[\s\S]*right:\s*32rpx/);
  assert.match(style, /\.profile-edit-surface\s*{[\s\S]*min-height:\s*52rpx/);
  assert.equal((template.match(/hover-class="metric-item--pressed"/g) || []).length, 3);
  for (const value of ['owned', 'joined', 'formed', 'history']) {
    assert.match(template, new RegExp(`data-value="${value}"[^>]*bindtap="handleListChange"`));
  }
  assert.match(template, /wx:if="\{\{tasks\.length\}\}"[^>]*class="quick-task-strip"/);
  assert.match(script, /profileIntro:/);
  assert.match(script, /decorateProfileActivity/);
});

test('活动记录使用日期时间线、类型插画和安全区避让', () => {
  const template = read('index.wxml');
  const style = read('index.wxss');

  assert.match(template, /class="timeline-date"/);
  assert.match(template, /class="timeline-cover-image"[^>]*mode="aspectFit"/);
  assert.match(template, /class="timeline-activity"[^>]*bindtap="handleActivityTap"/);
  assert.match(style, /padding-bottom:\s*calc\(164rpx \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(style, /@media \(max-width:\s*340px\)/);
  assert.match(style, /\.timeline-cover\s*{[\s\S]*width:\s*160rpx[\s\S]*height:\s*200rpx/);
  assert.match(style, /\.list-tab--active\s*{[\s\S]*font-size:\s*30rpx/);
  assert.match(style, /\.list-tab--active::before\s*{[\s\S]*width:\s*40rpx[\s\S]*height:\s*6rpx/);
});
