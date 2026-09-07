'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('发现页视觉骨架与我的页统一且全部列表状态位于白色面板', () => {
  const template = read('pages/discover/index.wxml');
  const sheetStart = template.indexOf('<view class="discover-sheet">');
  const sheetEnd = template.lastIndexOf('</view>');

  assert.ok(sheetStart > template.indexOf('<view class="discover-hero">'));
  for (const marker of ['search-row', 'filter-scroll', 'list-heading', 'skeleton-list', 'empty-state-shell']) {
    const index = template.indexOf(marker);
    assert.ok(index > sheetStart && index < sheetEnd, `${marker} 应位于白色内容面板内`);
  }
  assert.match(template, /<activity-card[^>]*variant="discover"[^>]*bindselect="handleCardSelect"/);
});

test('发现页现代视觉令牌不再使用奶油纸片和厚重蓝色投影', () => {
  const pageStyle = read('pages/discover/index.wxss');
  const cardStyle = read('components/activity-card/index.wxss');

  assert.match(pageStyle, /\.directory-tools\s*\{[^}]*background:\s*#f8fafc;[^}]*border-radius:\s*24rpx;/s);
  assert.match(pageStyle, /\.search-row\s*\{[^}]*background:\s*#fff;[^}]*border-radius:\s*18rpx;/s);
  assert.doesNotMatch(pageStyle, /#fff8ee|0 10rpx 0 rgba\(4, 48, 104/);
  assert.match(cardStyle, /\.activity-card--discover\s*\{[^}]*box-shadow:\s*0 6rpx 20rpx rgba\(15, 23, 42, 0\.04\)/s);
  assert.match(cardStyle, /\.activity-card--discover \.activity-title\s*\{[^}]*color:\s*#0f172a;/s);
});

test('发现页窄屏收紧面板和图文卡但保留四类横向筛选', () => {
  const pageStyle = read('pages/discover/index.wxss');
  const cardStyle = read('components/activity-card/index.wxss');

  assert.match(pageStyle, /@media \(max-width: 340px\)[\s\S]*\.discover-hero\s*\{[^}]*min-height:\s*300rpx;/);
  assert.match(pageStyle, /@media \(max-width: 340px\)[\s\S]*\.discover-sheet\s*\{[^}]*padding-right:\s*20rpx;[^}]*padding-left:\s*20rpx;/);
  assert.match(cardStyle, /@media \(max-width: 340px\)[\s\S]*\.activity-card--discover\s*\{[^}]*min-height:\s*350rpx;/);
  assert.match(cardStyle, /@media \(max-width: 340px\)[\s\S]*\.activity-card--discover \.card-cover\s*\{[^}]*flex-basis:\s*43%;[^}]*width:\s*43%;[^}]*min-height:\s*350rpx;/);
  assert.match(cardStyle, /@media \(max-width: 340px\)[\s\S]*\.activity-card--discover \.card-cover-image\s*\{[^}]*top:\s*38rpx;[^}]*width:\s*190rpx;[^}]*height:\s*190rpx;/);
});
