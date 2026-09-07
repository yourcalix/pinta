'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('首页列表状态与分页器均收进温暖活动托盘', () => {
  const template = read('pages/discover/index.wxml');
  const listStart = template.indexOf('<view class="home-activity-list">');
  const listEnd = template.indexOf('<view class="story-teaser"');
  for (const marker of ['skeleton-list', '<activity-card', 'empty-state-shell', 'discover-pagination']) {
    const index = template.indexOf(marker);
    assert.ok(index > listStart && index < listEnd, `${marker} 应位于活动托盘内`);
  }
});

test('首页现代视觉令牌使用米白、暖灰与克制阴影', () => {
  const pageStyle = read('pages/discover/index.wxss');
  const cardStyle = read('components/activity-card/index.wxss');
  assert.match(pageStyle, /\.directory-tools\s*\{[^}]*background:\s*#f2eee7[^}]*border-radius:\s*24rpx/s);
  assert.match(pageStyle, /\.search-row\s*\{[^}]*background:\s*#fff[^}]*border-radius:\s*20rpx/s);
  assert.match(cardStyle, /\.activity-card--discover\s*\{[^}]*border:\s*1\.5rpx solid #efece6[^}]*border-radius:\s*24rpx/s);
  assert.doesNotMatch(pageStyle, /shared-paper-bg|global-page-background-tint/);
});

test('首页在 340px 以下收紧 Hero、快捷卡与列表托盘', () => {
  const pageStyle = read('pages/discover/index.wxss');
  const cardStyle = read('components/activity-card/index.wxss');
  assert.match(pageStyle, /@media \(max-width:\s*340px\)[\s\S]*\.home-hero, \.home-hero-card\s*\{[^}]*height:\s*300rpx/s);
  assert.match(pageStyle, /@media \(max-width:\s*340px\)[\s\S]*\.home-shortcut\s*\{[^}]*min-height:\s*164rpx/s);
  assert.match(pageStyle, /@media \(max-width:\s*340px\)[\s\S]*\.home-activity-list\s*\{[^}]*padding:\s*14rpx/s);
  assert.match(cardStyle, /@media \(max-width:\s*340px\)[\s\S]*\.activity-card--discover\s*\{[^}]*min-height:\s*350rpx/s);
});
