'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram/pages/publish');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('发布入口页只保留一个体素化校园拼车入口', () => {
  const template = read('index.wxml');
  const script = read('index.js');

  assert.match(template, /class="publish-hero surface"/);
  assert.match(template, /brand-puzzle\.png/);
  assert.match(template, /ride-car-green\.png/);
  assert.match(template, /node-end-taipa\.png/);
  assert.match(template, /class="type-card surface"/);
  assert.match(template, /node-start-green\.png/);
  assert.match(template, /安全边界/);
  assert.doesNotMatch(template, /历史发布|草稿箱|路线快捷/);
  assert.match(script, /types:\s*\[[\s\S]*value:\s*'ride'/);
  assert.doesNotMatch(script, /value:\s*'product'|value:\s*'buddy'/);
});

test('发布入口装饰退出无障碍树且主卡提供完整操作语义', () => {
  const template = read('index.wxml');

  assert.match(template, /aria-label="发起校园拼车，点击进入发布行程表单"/);
  assert.match(template, /class="hero-puzzle"[\s\S]*aria-hidden="true"/);
  assert.match(template, /class="page-watermark"[\s\S]*aria-hidden="true"/);
  assert.match(template, /class="safety-icon"[\s\S]*aria-hidden="true"/);
});

test('最终视觉使用紧凑 Hero、轻量入口和非警告色安全卡', () => {
  const style = read('index.wxss');

  assert.match(style, /\.publish-hero\s*\{[\s\S]*min-height:\s*1(?:5|6|7|8)\d+rpx/);
  assert.match(style, /\.type-card\s*\{[\s\S]*min-height:\s*2[4-6]\d+rpx/);
  assert.match(style, /\.type-card\s*\{[\s\S]*border-left:\s*4rpx solid/);
  assert.match(style, /\.safety-note\s*\{[\s\S]*background:\s*#f3faf6/i);
  assert.doesNotMatch(style, /#fff8e8|#f1dfb7/);
  assert.match(style, /\.page-watermark\s*\{[\s\S]*opacity:\s*0\.0[123]/);
  assert.match(style, /\.hero-copy\s*\{[\s\S]*max-width:\s*250rpx[\s\S]*word-break:\s*break-all/);
  assert.match(style, /@media \(max-width:\s*340px\)/);
});
