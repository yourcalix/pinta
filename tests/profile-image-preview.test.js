'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../miniprogram/pages/user');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

test('我的页面头像与背景分别打开对应的单图预览', () => {
  const template = read('index.wxml');
  const script = read('index.js');
  const style = read('index.wxss');

  assert.match(template, /class="profile-background-preview"[^>]*bindtap="handleBackgroundPreview"[^>]*aria-label="查看背景大图"/);
  assert.match(template, /class="profile-avatar-shell"[^>]*bindtap="handleAvatarPreview"[^>]*aria-label="查看头像大图"/);
  assert.match(script, /handleAvatarPreview\(\)[\s\S]*this\.data\.profileAvatarPath/);
  assert.match(script, /handleBackgroundPreview\(\)[\s\S]*this\.data\.profileCoverPath/);
  assert.match(script, /wx\.previewImage\(\{[\s\S]*current: imagePath,[\s\S]*urls: \[imagePath\]/);
  assert.match(style, /\.profile-background-preview\s*{[\s\S]*position:\s*absolute[\s\S]*inset:\s*0/);
  assert.match(style, /\.profile-avatar-shell--pressed/);
});
