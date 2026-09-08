'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('首页三种列表状态均收进附近活动流', () => {
  const template = read('pages/discover/index.wxml');
  const listStart = template.indexOf('<view class="home-activity-stream">');
  for (const marker of ['activity-skeleton-card', '<activity-card', 'empty-state-shell']) {
    const index = template.indexOf(marker);
    assert.ok(index > listStart, `${marker} 应位于活动托盘内`);
  }
  assert.doesNotMatch(template, /page-end-marker/);
});

test('首页现代视觉令牌使用米白、暖灰与克制阴影', () => {
  const pageStyle = read('pages/discover/index.wxss');
  const cardStyle = read('components/activity-card/index.wxss');
  assert.match(pageStyle, /\.directory-tools\s*\{[^}]*max-height:\s*0[^}]*background:\s*rgba\(242, 238, 231, 0\.96\)[^}]*border-radius:\s*24rpx/s);
  assert.match(pageStyle, /\.directory-tools--expanded\s*\{[^}]*max-height:\s*240rpx[^}]*pointer-events:\s*auto/s);
  assert.match(pageStyle, /\.search-row\s*\{[^}]*background:\s*#fff[^}]*border-radius:\s*20rpx/s);
  assert.match(cardStyle, /\.activity-card--home-preview\s*\{[^}]*border:\s*1\.5rpx solid #efece6[^}]*border-radius:\s*22rpx/s);
  assert.doesNotMatch(pageStyle, /shared-paper-bg|global-page-background-tint/);
});

test('首页在 340px 以下收紧 Hero、快捷卡与活动骨架', () => {
  const pageStyle = read('pages/discover/index.wxss');
  const cardStyle = read('components/activity-card/index.wxss');
  assert.match(pageStyle, /@media \(max-width:\s*340px\)[\s\S]*\.home-hero\s*\{[^}]*height:\s*540rpx/s);
  assert.match(pageStyle, /@media \(max-width:\s*340px\)[\s\S]*\.home-shortcut\s*\{[^}]*height:\s*200rpx/s);
  assert.match(pageStyle, /@media \(max-width:\s*340px\)[\s\S]*\.activity-skeleton-card\s*\{[^}]*height:\s*286rpx/s);
  assert.match(cardStyle, /@media \(max-width:\s*340px\)[\s\S]*\.activity-card--home-preview\s*\{[^}]*height:\s*286rpx/s);
});
