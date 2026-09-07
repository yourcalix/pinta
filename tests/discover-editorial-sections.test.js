'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('首页按问候、生活方式 Hero、快捷入口、检索与活动流顺序渲染', () => {
  const template = read('pages/discover/index.wxml');
  const markers = ['home-greeting', 'home-hero', 'home-shortcuts', 'directory-tools', 'home-activity-heading', 'home-activity-list', 'page-end-marker'];
  const positions = markers.map((marker) => template.indexOf(marker));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(template, /autoplay="\{\{banners\.length > 1\}\}"/);
  assert.match(template, /interval="4500"/);
  assert.match(template, /duration="400"/);
  assert.match(template, /— 已经到底啦 · 拼吧 —/);
});
test('首页采用温暖米白生活方式视觉而不复用旧深蓝画报骨架', () => {
  const template = read('pages/discover/index.wxml');
  const style = read('pages/discover/index.wxss');
  assert.match(template, /class="home-greeting"[^>]*aria-label="你好，搭子，欢迎回到拼吧"/);
  assert.match(template, /class="hero-title"[\s\S]*你的搭子，[\s\S]*刚刚好。/);
  assert.match(template, /class="home-shortcuts"[\s\S]*组队拼单[\s\S]*社区动态[\s\S]*发起活动/);
  assert.match(style, /\.home-page\s*\{[^}]*background:\s*#f9f7f2/s);
  assert.match(style, /\.home-hero\s*\{[^}]*height:\s*340rpx[^}]*border-radius:\s*32rpx/s);
  assert.match(style, /\.home-shortcuts\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s);
  assert.match(style, /\.home-shortcut\s*\{[^}]*min-height:\s*180rpx/s);
  assert.doesNotMatch(template, /discover-art-title|HOT PINBA|memory-grid|memory-panel/);
  assert.doesNotMatch(style, /#075aa7|#207be5/i);
});

test('活动流继续承载五条游标分页、真实活动卡与空态', () => {
  const template = read('pages/discover/index.wxml');
  const style = read('pages/discover/index.wxss');
  assert.match(template, /<activity-card[^>]*variant="discover"[^>]*bindselect="handleCardSelect"/);
  assert.match(template, /class="discover-pagination"/);
  assert.match(template, /bindtap="handlePrevPage"/);
  assert.match(template, /bindtap="handleNextPage"/);
  assert.match(template, /第\s*\{\{currentPage\}\}\s*页/);
  assert.match(style, /\.home-activity-list\s*\{[^}]*background:\s*#f2eee7[^}]*border-radius:\s*28rpx/s);
  assert.match(style, /\.pagination-button\s*\{[^}]*min-height:\s*88rpx/s);
});

test('首页不挂载未来成团记忆 UGC 模块且末页由终点文案收口', () => {
  const template = read('pages/discover/index.wxml');
  const script = read('pages/discover/index.js');
  const style = read('pages/discover/index.wxss');
  assert.doesNotMatch(template, /story-teaser|OUR STORIES|成团记忆/);
  assert.doesNotMatch(style, /\.story-(?:teaser|copy|eyebrow|title|subtitle|art|photo|sun)/);
  assert.doesNotMatch(script, /activityService\.memories|fetchMemories|handleMemorySelect|memoriesExpanded/);
  assert.match(template, /<\/view>\s*<view wx:if="\{\{activities\.length && !loading && !hasNextPage\}\}" class="page-end-marker"/);
  assert.match(style, /\.page-end-marker\s*\{[^}]*margin:\s*28rpx auto 16rpx/s);
});
