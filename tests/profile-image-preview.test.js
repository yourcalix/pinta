'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { profileImagePreviewPath, PREVIEW_PATHS } = require('../miniprogram/utils/profile-image-preview');

const ROOT = path.join(__dirname, '../miniprogram/pages/user');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

test('我的页面头像与背景分别打开对应的单图预览', () => {
  const template = read('index.wxml');
  const script = read('index.js');
  const style = read('index.wxss');

  assert.match(template, /class="profile-background-preview"[^>]*bindtap="handleBackgroundPreview"[^>]*aria-label="查看背景大图"/);
  assert.match(template, /class="profile-avatar-shell"[^>]*bindtap="handleAvatarPreview"[^>]*aria-label="查看头像大图"/);
  assert.match(script, /handleAvatarPreview\(\)[\s\S]*profileImagePreviewPath\(this\.data\.profileAvatarPath\)/);
  assert.match(script, /handleBackgroundPreview\(\)[\s\S]*profileImagePreviewPath\(this\.data\.profileCoverPath\)/);
  assert.match(script, /wx\.getImageInfo\(\{[\s\S]*src: imagePath,[\s\S]*success: \(result\) => openPreview\(result\.path \|\| imagePath\)/);
  assert.match(script, /wx\.previewImage\(\{[\s\S]*current: resolvedPath,[\s\S]*urls: \[resolvedPath\]/);
  assert.match(script, /if \(this\._isPreviewing \|\| !imagePath/);
  assert.match(script, /this\._previewUnlockTimer = setTimeout\([\s\S]*}, 1000\)/);
  assert.match(script, /onUnload\(\)[\s\S]*clearTimeout\(this\._previewUnlockTimer\)/);
  assert.match(style, /\.profile-background-preview\s*{[\s\S]*position:\s*absolute[\s\S]*inset:\s*0/);
  assert.match(style, /\.profile-avatar-shell--pressed/);
});

test('预览资源由WebP白名单映射到原生预览兼容的JPEG', () => {
  for (const [displayPath, previewPath] of Object.entries(PREVIEW_PATHS)) {
    assert.match(displayPath, /\.webp$/);
    assert.match(previewPath, /-preview\.jpg$/);
    assert.equal(profileImagePreviewPath(displayPath), previewPath);
    const absolutePath = path.join(__dirname, '../miniprogram', previewPath);
    const file = fs.readFileSync(absolutePath);
    assert.deepEqual([...file.subarray(0, 3)], [0xff, 0xd8, 0xff]);
    assert.ok(file.length > 1024);
  }
  assert.equal(profileImagePreviewPath('https://example.com/unsafe.jpg'), '');
});
