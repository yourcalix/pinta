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
  assert.match(template, /class="hero-copy-group"/);
  assert.match(template, /brand-puzzle\.png/);
  assert.match(template, /ride-car-green\.png/);
  assert.match(template, /node-end-taipa\.png/);
  assert.match(template, /class="type-card surface"/);
  assert.match(template, /route-section-pin\.png/);
  assert.match(template, /class="type-accent"/);
  assert.doesNotMatch(template, /class="type-watermark"/);
  assert.match(template, /安全边界/);
  assert.doesNotMatch(template, /历史发布|草稿箱|路线快捷/);
  assert.match(script, /types:\s*\[[\s\S]*value:\s*'ride'/);
  assert.doesNotMatch(script, /value:\s*'product'|value:\s*'buddy'/);
});

test('发布入口装饰退出无障碍树且主卡提供完整操作语义', () => {
  const template = read('index.wxml');
  const script = read('index.js');

  assert.match(template, /aria-label="发起校园拼车，点击进入发布行程表单"/);
  assert.match(template, /class="hero-puzzle"[\s\S]*aria-hidden="true"/);
  assert.match(template, /class="page-watermark"[\s\S]*aria-hidden="true"/);
  assert.match(template, /class="safety-icon"[\s\S]*aria-hidden="true"/);
  assert.match(template, /class="safety-note"[\s\S]*role="button"[\s\S]*bindtap="handleSafetyNotice"/);
  assert.match(template, /class="safety-note"[\s\S]*hover-class="safety-note-hover"/);
  assert.match(script, /handleSafetyNotice\(\)[\s\S]*wx\.showModal/);
});

test('最终视觉使用紧凑 Hero、悬空强调线和低权重安全提示', () => {
  const style = read('index.wxss');

  assert.match(style, /\.publish-hero\s*\{[\s\S]*min-height:\s*1(?:5|6|7|8)\d+rpx/);
  assert.match(style, /\.type-card\s*\{[\s\S]*min-height:\s*2[4-6]\d+rpx/);
  assert.doesNotMatch(style, /\.type-card\s*\{[\s\S]*border-left:/);
  assert.match(style, /\.type-accent\s*\{[\s\S]*height:\s*1(?:1|2|3)\d+rpx[\s\S]*top:\s*50%[\s\S]*translateY\(-50%\)/);
  assert.match(style, /\.safety-note\s*\{[\s\S]*border:\s*1rpx dashed #cde8db/i);
  assert.match(style, /\.safety-note\s*\{[\s\S]*background:\s*rgba\(255, 255, 255, 0\.34\)/i);
  assert.match(style, /\.safety-note::after\s*\{[\s\S]*display:\s*none/);
  assert.match(style, /\.safety-note::after\s*\{[\s\S]*border:\s*none\s*!important/);
  assert.match(style, /\.safety-note-hover\s*\{[\s\S]*rgba\(22, 163, 106, 0\.05\)/);
  assert.doesNotMatch(style, /#fff8e8|#f1dfb7/);
  assert.match(style, /\.page-watermark\s*\{[\s\S]*width:\s*120rpx[\s\S]*opacity:\s*0\.03/);
  assert.match(style, /\.hero-copy\s*\{[\s\S]*max-width:\s*250rpx[\s\S]*word-break:\s*break-all/);
  assert.match(style, /\.hero-copy-group\s*\{[\s\S]*max-width:\s*60%[\s\S]*min-width:\s*0/);
  assert.match(style, /@media \(max-width:\s*340px\)/);
});
