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

test('筛选 Chip 在文字前呈现受控图标且保留 Tab 语义', () => {
  const template = read('pages/discover/index.wxml');
  assert.match(template, /role="tab"[^>]*aria-selected/);
  assert.match(template, /class="filter-icon"[^>]*src="\{\{item\.iconSrc\}\}"[^>]*aria-hidden="true"/);
  assert.ok(template.indexOf('class="filter-icon"') < template.indexOf('<text>{{item.label}}</text>'));
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

test('筛选图标透明融入暖灰工具带并保留窄屏尺寸保护', () => {
  const styles = read('pages/discover/index.wxss');
  assert.match(styles, /\.filter-icon\s*\{[^}]*width:\s*34rpx;[^}]*height:\s*34rpx;/s);
  assert.match(styles, /@media \(max-width:\s*340px\)[\s\S]*\.filter-icon\s*\{[^}]*width:\s*30rpx;[^}]*height:\s*30rpx;/s);
});

test('筛选项使用暖灰默认态、白色选中态并保持 88rpx 触控高度', () => {
  const styles = read('pages/discover/index.wxss');
  assert.match(styles, /\.filter-chip\s*\{[^}]*min-height:\s*88rpx;[^}]*color:\s*#777168;[^}]*background:\s*transparent;/s);
  assert.match(styles, /\.filter-chip--active\s*\{[^}]*color:\s*#111827;[^}]*background:\s*#fff;/s);
  assert.doesNotMatch(styles, /\.filter-chip--(?:companion|sport|food)\.filter-chip--active/);
  assert.match(styles, /\.filter-icon\s*\{[^}]*filter:\s*saturate\(0\.6\);/s);
});
