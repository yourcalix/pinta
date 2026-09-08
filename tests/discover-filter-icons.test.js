'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const icons = ['all', 'companion', 'sport', 'food'];

function pngDimensions(buffer) {
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test('发现页四个类型筛选使用受控英文图标路径', () => {
  const script = read('pages/discover/index.js');
  icons.forEach((name) => {
    assert.match(script, new RegExp(`filter-${name}\\.png`));
  });
  assert.doesNotMatch(script, /模块图标|桌面|Desktop/);
});

test('首页移除正文流筛选 Chip 并改用 Hero 内搜索浮层', () => {
  const template = read('pages/discover/index.wxml');
  assert.match(template, /class="hero-search-floating-bar/);
  assert.match(template, /placeholder="搜索活动\/发起人"/);
  assert.doesNotMatch(template, /role="tab"|class="filter-icon"|class="filter-chip/);
});

test('筛选图标为72像素小型PNG且总量不超过16KB', () => {
  let totalBytes = 0;
  icons.forEach((name) => {
    const file = path.join(root, `assets/images/discover/filter-${name}.png`);
    const buffer = fs.readFileSync(file);
    assert.deepEqual(pngDimensions(buffer), { width: 72, height: 72 });
    totalBytes += buffer.length;
  });
  assert.ok(totalBytes <= 16 * 1024, `筛选图标总量为 ${totalBytes} bytes`);
});

test('搜索微图标在标准屏和窄屏保持紧凑尺寸', () => {
  const styles = read('pages/discover/index.wxss');
  assert.match(styles, /\.hero-search-icon\s*\{[^}]*width:\s*24rpx;[^}]*height:\s*24rpx;/s);
  assert.match(styles, /@media \(max-width:\s*340px\)[\s\S]*\.hero-search-icon\s*\{[^}]*width:\s*22rpx;[^}]*height:\s*22rpx;/s);
});

test('搜索浮层与右上按钮等高、右对齐且不进入正文流', () => {
  const styles = read('pages/discover/index.wxss');
  assert.match(styles, /\.hero-search-floating-bar\s*\{[^}]*position:\s*absolute;[^}]*top:\s*116rpx;[^}]*right:\s*38rpx;[^}]*width:\s*340rpx;[^}]*height:\s*64rpx;/s);
  assert.match(styles, /@media \(max-width:\s*340px\)[\s\S]*\.hero-search-floating-bar\s*\{[^}]*top:\s*98rpx;[^}]*right:\s*28rpx;[^}]*width:\s*290rpx;[^}]*height:\s*58rpx;/s);
  assert.doesNotMatch(styles, /\.filter-chip|\.filter-scroll|\.directory-tools/);
});
