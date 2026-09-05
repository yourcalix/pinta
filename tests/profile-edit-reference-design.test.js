'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../miniprogram/subpackages/profile/edit');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

test('编辑主页采用参考式白灰页面、自定义导航和固定保存底栏', () => {
  const template = read('index.wxml');
  const style = read('index.wxss');
  const config = JSON.parse(read('index.json'));

  assert.equal(config.navigationStyle, 'custom');
  assert.equal(config.backgroundColor, '#F6F7F9');
  assert.match(template, /class="profile-navigation"[^>]*style="height: \{\{contentTopInset\}\}px;"/);
  assert.match(template, /class="profile-nav-title">个人资料/);
  assert.match(template, /class="fixed-save-bar"/);
  assert.match(style, /\.profile-page\s*{[\s\S]*background:\s*#f6f7f9/);
  assert.match(style, /\.fixed-save-bar\s*{[\s\S]*position:\s*fixed[\s\S]*padding-bottom:\s*calc\(14rpx \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(style, /\.save-button\s*{[\s\S]*min-height:\s*92rpx[\s\S]*border-radius:\s*46rpx/);
  assert.match(style, /\.profile-page\s*{[\s\S]*padding-bottom:\s*calc\(160rpx \+ env\(safe-area-inset-bottom\)\)/);
});

test('编辑主页只呈现真实资料字段且受控头像随性别联动', () => {
  const template = read('index.wxml');
  const script = read('index.js');

  assert.match(template, /class="controlled-avatar"[^>]*src="\{\{profileAvatarPath\}\}"/);
  assert.match(template, /头像根据性别自动生成，暂不支持自定义上传/);
  assert.match(template, /class="profile-row nickname-row"[^>]*bindtap="handleNicknameOpen"/);
  assert.match(template, /class="row-chevron"[^>]*aria-hidden="true">›/);
  assert.match(template, /bindchange="handleGenderPick"/);
  assert.doesNotMatch(template, /年龄确认|已确认满18岁|请确认已满18岁/);
  assert.match(template, /data-field="interestsText"/);
  assert.match(script, /profileAvatarPath\(gender\)/);
  assert.doesNotMatch(template, /MBTI|手机号|常用报名|切换账号|1\/20|class="avatar-add"/);
});

test('行式编辑保留窄屏、键盘、错误与生日年龄核验能力', () => {
  const template = read('index.wxml');
  const style = read('index.wxss');

  assert.match(template, /adjust-position="\{\{true\}\}"/);
  assert.match(template, /cursor-spacing="140"/);
  assert.match(template, /class="profile-row birthday-row"/);
  assert.match(template, /wx:if="\{\{errorMessage\}\}"[^>]*role="alert"/);
  assert.match(style, /\.profile-row\s*{[\s\S]*min-height:\s*104rpx/);
  assert.match(style, /\.row-control\s*{[\s\S]*flex:\s*1[\s\S]*min-width:\s*0[\s\S]*text-align:\s*right/);
  assert.match(style, /\.avatar-section\s*{[\s\S]*pointer-events:\s*none/);
  assert.match(style, /@media \(max-width:\s*340px\)/);
});
