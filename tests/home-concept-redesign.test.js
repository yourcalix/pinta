'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pngInfo = (file) => {
  const buffer = fs.readFileSync(path.join(root, file));
  return { bytes: buffer.length, width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), colorType: buffer[25] };
};

test('五栏导航以首页和发现开头且物理路径保持不变', () => {
  const app = JSON.parse(read('app.json'));
  assert.deepEqual(app.tabBar.list.map((item) => item.text), ['首页', '发现', '发布', '消息', '我的']);
  assert.deepEqual(app.tabBar.list.slice(0, 2).map((item) => item.pagePath), ['pages/discover/index', 'pages/community/index']);
});

test('自定义导航采用白色悬浮胶囊、黑色发布圆钮和黄色选中点', () => {
  const template = read('custom-tab-bar/index.wxml');
  const style = read('custom-tab-bar/index.wxss');
  assert.match(template, /class="tab-selected-dot [^"]*"/);
  assert.match(template, /class="publish-circle"[\s\S]*class="publish-plus-image"/);
  assert.match(template, /class="tab-icon-image"/);
  assert.match(style, /\.tab-shell\s*\{[^}]*left:\s*24rpx;[^}]*right:\s*24rpx;[^}]*bottom:\s*calc\(24rpx \+ env\(safe-area-inset-bottom\)\);[^}]*height:\s*116rpx;/s);
  assert.match(style, /\.tab-paper\s*\{[^}]*background:\s*#fff;[^}]*border-radius:\s*58rpx;/s);
  assert.match(style, /\.publish-circle\s*\{[^}]*width:\s*92rpx;[^}]*height:\s*92rpx;[^}]*background:\s*#111827;[^}]*border-radius:\s*50%;/s);
  assert.match(style, /\.tab-selected-dot\s*\{[^}]*background:\s*#f59e0b;/s);
});

test('新首页按问候、Lifestyle Hero、三快捷卡、搜索和活动顺序排版', () => {
  const template = read('pages/discover/index.wxml');
  const style = read('pages/discover/index.wxss');
  const script = read('pages/discover/index.js');
  const markers = ['home-greeting', 'home-hero', 'home-shortcuts', 'directory-tools', 'home-activity-heading', 'home-activity-stream'];
  const positions = markers.map((marker) => template.indexOf(marker));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(template, /你的搭子/);
  assert.match(template, /刚刚好/);
  assert.match(template, /data-action="activities"/);
  assert.match(template, /class="shortcut-subtitle shortcut-subtitle--activities">看看大家都在聊什么<\/text>/);
  assert.match(template, /data-action="memories"/);
  assert.match(template, /home-shortcut--placeholder/);
  assert.match(script, /shortcut-group\.png/);
  assert.match(script, /shortcut-memory\.png/);
  assert.match(script, /shortcut-placeholder\.png/);
  assert.match(template, /variant="home-preview"/);
  assert.match(template, /home-activity-grid/);
  assert.match(style, /\.home-page\s*\{[^}]*background:\s*#f9f7f2;/s);
  assert.match(style, /\.home-hero\s*\{[^}]*height:\s*560rpx;/s);
  assert.match(style, /\.home-content\s*\{[^}]*margin-top:\s*-48rpx;[^}]*padding:\s*0 24rpx 0;/s);
  assert.match(style, /\.home-hero\s*\{[^}]*margin-top:\s*4rpx;/s);
  assert.match(style, /\.hero-title\s*\{[^}]*font-size:\s*52rpx;/s);
  assert.match(style, /\.home-shortcuts\s*\{[^}]*height:\s*220rpx;[^}]*margin-top:\s*-98rpx;/s);
  assert.match(style, /\.shortcut-icon-slot\s*\{[^}]*width:\s*124rpx;[^}]*height:\s*124rpx;/s);
  assert.match(style, /\.shortcut-subtitle--activities\s*\{[^}]*font-size:\s*16rpx;[^}]*letter-spacing:\s*-1rpx;/s);
  assert.match(template, /class="hero-illustration-slot" aria-hidden="true"/);
  assert.doesNotMatch(template, /story-teaser|OUR STORIES|成团记忆/);
});

test('附近拼吧常规模式严格使用三列紧凑卡并每次追加三条', () => {
  const template = read('pages/discover/index.wxml');
  const style = read('pages/discover/index.wxss');
  const script = read('pages/discover/index.js');
  assert.match(style, /\.home-activity-grid\s*\{[^}]*width:\s*100%;[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);[^}]*gap:\s*21rpx;/s);
  assert.match(style, /@media \(max-width:\s*340px\)[\s\S]*\.home-activity-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);[^}]*gap:\s*12rpx;/s);
  assert.match(template, /wx:if="\{\{isPaging\}\}"[\s\S]*wx:for="\{\{\[1,2,3\]\}\}"/);
  assert.match(template, /wx:if="\{\{hasNextPage\}\}" class="load-more-heading/);
  assert.match(script, /const PAGE_SIZE = 3;/);
});

test('用户提供的十张首页素材按槽位缩放且保留完整 Alpha', () => {
  const assets = [
    ['assets/images/home/shortcut-group.png', 160],
    ['assets/images/home/shortcut-memory.png', 160],
    ['assets/images/home/shortcut-placeholder.png', 160],
    ['assets/icons/home/header-bell.png', 80],
    ['assets/icons/home/header-search.png', 80],
    ['custom-tab-bar/assets/concept-a/tab-home.png', 96],
    ['custom-tab-bar/assets/concept-a/tab-discover.png', 96],
    ['custom-tab-bar/assets/concept-a/tab-message.png', 96],
    ['custom-tab-bar/assets/concept-a/tab-user.png', 96],
    ['custom-tab-bar/assets/concept-a/tab-publish-plus.png', 96]
  ];
  let totalBytes = 0;
  assets.forEach(([file, size]) => {
    const info = pngInfo(file);
    totalBytes += info.bytes;
    assert.deepEqual([info.width, info.height, info.colorType], [size, size, 6], file);
  });
  assert.ok(totalBytes < 150 * 1024, `素材总大小 ${totalBytes} 应小于 150KB`);
});

test('新发现页只消费真实讨论并使用温暖生活方式内容流', () => {
  const template = read('pages/community/index.wxml');
  const style = read('pages/community/index.wxss');
  assert.match(template, /class="discover-square-title"[^>]*>发现/);
  assert.match(template, /正在发生/);
  assert.match(template, /热门讨论/);
  assert.match(template, /class="discover-compose-button"[\s\S]*bindtap="handleCompose"/);
  assert.doesNotMatch(template, /社区快捷入口|shortcut-card--rules|community-ambient-bg/);
  assert.match(style, /\.community-page\s*\{[^}]*background:\s*#f9f7f2;/s);
  assert.match(style, /padding-bottom:\s*calc\(180rpx \+ env\(safe-area-inset-bottom\)\)/);
});
