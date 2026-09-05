'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_PROFILE_COVER,
  PROFILE_COVER_STORAGE_KEY,
  normalizeProfileCover,
  readProfileCover,
  writeProfileCover,
  resolveProfileCover
} = require('../miniprogram/utils/profile-cover');

const ROOT = path.join(__dirname, '../miniprogram');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('背景偏好只接受白名单值并对异常存储回退澳门海景', () => {
  assert.equal(normalizeProfileCover('avatar_ambient'), 'avatar_ambient');
  for (const value of [null, undefined, '', '../unsafe.png', 'https://example.com/a.png']) {
    assert.equal(normalizeProfileCover(value), DEFAULT_PROFILE_COVER);
  }
  assert.equal(readProfileCover({ getStorageSync: () => 'avatar_ambient' }), 'avatar_ambient');
  assert.equal(readProfileCover({ getStorageSync: () => '/tmp/free-path.png' }), DEFAULT_PROFILE_COVER);
  assert.equal(readProfileCover({ getStorageSync: () => { throw new Error('storage denied'); } }), DEFAULT_PROFILE_COVER);
});

test('背景写入只保存白名单键且失败时不伪造成功', () => {
  const writes = [];
  assert.equal(writeProfileCover({ setStorageSync: (key, value) => writes.push([key, value]) }, 'avatar_ambient'), true);
  assert.deepEqual(writes, [[PROFILE_COVER_STORAGE_KEY, 'avatar_ambient']]);
  assert.equal(writeProfileCover({ setStorageSync: () => { throw new Error('full'); } }, 'macao_seascape'), false);
  assert.equal(writeProfileCover({ setStorageSync: () => writes.push(['unsafe']) }, '../unsafe.png'), false);
  assert.equal(writes.length, 1);
});

test('背景展示配置固定为本地资产或受控头像路径', () => {
  const defaultCover = resolveProfileCover('bad-value', '/avatar.webp');
  assert.equal(defaultCover.key, 'macao_seascape');
  assert.equal(defaultCover.path, '/assets/images/profile/profile-default-cover.webp');
  assert.equal(defaultCover.usesAvatar, false);
  const avatarCover = resolveProfileCover('avatar_ambient', '/avatar.webp');
  assert.equal(avatarCover.path, '/avatar.webp');
  assert.equal(avatarCover.usesAvatar, true);
});

test('我的页默认接入海景，编辑页提供受控背景入口', () => {
  const userTemplate = read('pages/user/index.wxml');
  const userScript = read('pages/user/index.js');
  const userStyle = read('pages/user/index.wxss');
  const editTemplate = read('subpackages/profile/edit/index.wxml');
  const editScript = read('subpackages/profile/edit/index.js');
  const editStyle = read('subpackages/profile/edit/index.wxss');

  assert.match(userTemplate, /class="profile-atmosphere-image[^"]*\{\{profileCoverUsesAvatar/);
  assert.match(userTemplate, /src="\{\{profileCoverPath\}\}"[^>]*mode="aspectFill"/);
  assert.match(userScript, /readProfileCover\(wx\)/);
  assert.match(userStyle, /\.profile-atmosphere-image--seascape\s*{[\s\S]*filter:\s*none/);
  assert.match(userStyle, /rgba\(12, 28, 48, 0\.38\)[\s\S]*rgba\(8, 24, 44, 0\.96\)/);

  assert.match(editTemplate, /更换背景/);
  assert.match(editTemplate, /class="cover-thumbnail[^"]*"[^>]*src="\{\{currentCoverPath\}\}"/);
  assert.match(editTemplate, /bindtap="handleSelectCover"/);
  assert.match(editScript, /wx\.showActionSheet/);
  assert.match(editScript, /writeProfileCover/);
  assert.match(editStyle, /\.cover-row\s*{[\s\S]*min-height:\s*104rpx/);
  assert.doesNotMatch(editTemplate, /上传背景|从相册选择|avatar-add/);
});
