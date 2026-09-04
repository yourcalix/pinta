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

test('筛选Chip在文字前呈现装饰图标且保留Tab语义', () => {
  const template = read('pages/discover/index.wxml');
  assert.match(template, /role="tab"[^>]*aria-selected/);
  assert.match(template, /chip-icon-box[^>]*aria-hidden="true"/);
  assert.match(template, /chip-icon-img[^>]*src="\{\{item\.iconSrc\}\}"[^>]*aria-hidden="true"/);
  assert.ok(template.indexOf('chip-icon-box') < template.indexOf('chip-label'));
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

test('筛选图标放大后透明融入Chip并保留触控穿透和窄屏保护', () => {
  const styles = read('pages/discover/index.wxss');
  const iconBox = styles.match(/\.chip-icon-box\s*\{([^}]*)\}/s)?.[1] || '';
  assert.match(iconBox, /width:\s*48rpx;/);
  assert.match(iconBox, /height:\s*48rpx;/);
  assert.match(iconBox, /pointer-events:\s*none;/);
  assert.doesNotMatch(iconBox, /background:|border:|border-radius:|box-shadow:/);
  assert.match(styles, /\.chip-icon-img\s*\{[^}]*pointer-events:\s*none;/s);
  assert.match(styles, /@media \(max-width: 340px\)[\s\S]*\.chip-icon-box\s*\{[^}]*width:\s*42rpx;[^}]*height:\s*42rpx;/);
});
