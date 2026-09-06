'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('发现页按 Banner、搜索、筛选、活动流、成团记忆顺序渲染', () => {
  const template = read('pages/discover/index.wxml');
  const markers = ['campaign-swiper', 'search-row', 'filter-scroll', 'list-heading', 'memory-section'];
  const positions = markers.map((marker) => template.indexOf(marker));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(template, /autoplay="{{banners\.length > 1}}"/);
  assert.match(template, /interval="4500"/);
  assert.match(template, /duration="400"/);
  assert.match(template, /class="memory-section memory-section--teaser"/);
});

test('发现页以成团记忆为视觉母版统一艺术标题、目录工具带和活动章节', () => {
  const template = read('pages/discover/index.wxml');
  const style = read('pages/discover/index.wxss');

  assert.match(template, /class="discover-header"[^>]*role="heading"[^>]*aria-label="拼吧发现/);
  assert.match(template, /class="discover-art-title"/);
  assert.match(template, /class="discover-art-title-base">拼吧 · <\/text>/);
  assert.match(template, /class="discover-art-title-accent">发现<\/text>/);
  assert.match(template, /class="directory-tools"[\s\S]*class="search-row"[\s\S]*class="filter-scroll"/);
  assert.match(template, /class="search-clear-button"[^>]*hover-class="search-clear--pressed"[^>]*hover-stay-time="80"/);
  assert.match(template, /class="session-heading-watermark"[^>]*>ACTIVE SESSIONS<\/view>/);
  assert.match(template, /class="session-heading-title">\{\{hasActiveFilters \? '筛选结果' : '正在组队'\}\}<\/text>/);

  assert.match(style, /\.discover-hero\s*\{[^}]*min-height:\s*340rpx;/s);
  assert.match(style, /\.discover-art-title\s*\{[^}]*transform:\s*rotate\(-3deg\);/s);
  assert.match(style, /\.discover-art-title-accent\s*\{[^}]*color:\s*#ffe600;/s);
  assert.match(style, /\.directory-tools\s*\{[^}]*background:\s*#f8fafc;[^}]*border-radius:\s*24rpx;/s);
  assert.match(style, /\.search-submit-button\s*\{[^}]*min-width:\s*88rpx;/s);
  assert.match(style, /\.filter-chip\s*\{[^}]*min-height:\s*88rpx;/s);
  assert.match(style, /\.session-heading-watermark\s*\{[^}]*letter-spacing:\s*4rpx;/s);
  assert.match(style, /@media \(max-width:\s*340px\)[\s\S]*\.discover-hero\s*\{[^}]*min-height:\s*300rpx;/s);
});

test('发现页 Banner 使用既有 PNG 和受控跳转，成团记忆保持静态 1+2 拼贴', () => {
  const template = read('pages/discover/index.wxml');
  const script = read('pages/discover/index.js');
  const style = read('pages/discover/index.wxss');
  assert.match(script, /publish-cover-companion\.png/);
  assert.match(script, /publish-cover-sport\.png/);
  assert.match(script, /publish-cover-food\.png/);
  assert.doesNotMatch(script, /\.webp/);
  assert.match(script, /BANNER_ROUTE_WHITELIST/);
  assert.match(style, /\.campaign-swiper\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*7;/s);
  assert.match(template, /class="memory-grid memory-grid--3"/);
  assert.doesNotMatch(script, /activityService\.memories|fetchMemories|handleMemorySelect|handleToggleMemories|memoriesExpanded/);
  assert.match(style, /@media \(max-width: 340px\)[\s\S]*\.campaign-swiper/);
});

test('成团记忆采用 OUR STORIES 静态预告、亮蓝画报与左大右双占位', () => {
  const template = read('pages/discover/index.wxml');
  const memoryMarkup = template.slice(template.indexOf('<view class="memory-section'));
  const style = read('pages/discover/index.wxss');
  assert.match(template, /class="memory-heading-watermark"[^>]*aria-hidden="true"[^>]*>OUR STORIES/);
  assert.match(template, /class="memory-title"[^>]*>成团记忆/);
  assert.match(template, /class="memory-section memory-section--teaser"[^>]*role="region"[^>]*aria-label="成团记忆，分享功能即将开放，敬请期待"/);
  assert.match(template, /class="memory-panel memory-panel--teaser"[^>]*aria-hidden="true"/);
  assert.match(template, /class="memory-camera"/);
  assert.match(template, /class="memory-art-title-first">分享你的/);
  assert.match(template, /class="memory-panel-masthead-accent">成团/);
  assert.match(template, /class="memory-placeholder memory-placeholder--lead"[\s\S]*成团故事[\s\S]*分享功能即将开放/);
  assert.match(template, /class="memory-placeholder memory-placeholder--top"[\s\S]*虚位以待[\s\S]*敬请期待/);
  assert.match(template, /class="memory-placeholder memory-placeholder--bottom"[\s\S]*等你来分享[\s\S]*记录精彩瞬间/);
  assert.doesNotMatch(memoryMarkup, /bindtap|role="button"|查看活动详情|memory-more-button|查看更多/);

  assert.match(style, /\.memory-section-heading\s*\{[^}]*position:\s*relative;[^}]*height:\s*100rpx;[^}]*text-align:\s*center;/s);
  assert.match(style, /\.memory-heading-watermark\s*\{[^}]*font-size:\s*26rpx;[^}]*letter-spacing:\s*4rpx;/s);
  assert.match(style, /\.memory-panel\s*\{[^}]*padding:\s*24rpx;[^}]*background:\s*linear-gradient\(180deg,\s*#4fa4f8 0%,\s*#207be5 100%\)/is);
  assert.match(style, /\.memory-panel\s*\{[^}]*margin-bottom:\s*24rpx;/s);
  assert.match(style, /\.memory-art-title\s*\{[^}]*text-shadow:[^}]*transform:\s*rotate\(-3deg\);/s);
  assert.match(style, /\.memory-art-title-first\s*\{[^}]*font-size:\s*42rpx;/s);
  assert.match(style, /\.memory-art-title-second\s*\{[^}]*font-size:\s*52rpx;/s);
  assert.match(style, /\.memory-grid--3\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[^}]*grid-template-rows:\s*286rpx 286rpx;/s);
  assert.match(style, /\.memory-placeholder--lead\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*1 \/ 3;[^}]*height:\s*588rpx;/s);
  assert.match(style, /\.memory-placeholder\s*\{[^}]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.12\);[^}]*border:\s*2rpx dashed rgba\(255,\s*255,\s*255,\s*0\.35\);[^}]*pointer-events:\s*none;/s);
  assert.match(style, /\.memory-panel--teaser\s*\{[^}]*pointer-events:\s*none;/s);
  assert.doesNotMatch(style, /\.memory-card|\.memory-more-button|\.memory-extra/);
  assert.match(style, /@media \(max-width:\s*340px\)[\s\S]*\.memory-grid--3\s*\{[^}]*grid-template-rows:\s*248rpx 248rpx;/s);
  assert.match(style, /@media \(max-width:\s*340px\)[\s\S]*\.memory-placeholder--lead\s*\{[^}]*height:\s*508rpx;/s);
});

test('成团记忆静态专题板保持参考图纵向比例和固定三槽几何', () => {
  const template = read('pages/discover/index.wxml');
  const style = read('pages/discover/index.wxss');
  assert.match(template, /class="memory-grid memory-grid--3"/);
  assert.doesNotMatch(template, /wx:for="\{\{(?:visible|featured|extra)Memories\}\}"|memory-panel--expanded/);
  assert.match(style, /\.memory-panel\s*\{[^}]*min-height:\s*860rpx;[^}]*aspect-ratio:\s*347\s*\/\s*430;/s);
  assert.match(style, /\.memory-panel-masthead\s*\{[^}]*min-height:\s*196rpx;/s);
  assert.match(style, /@media \(max-width:\s*340px\)[\s\S]*\.memory-panel\s*\{[^}]*min-height:\s*744rpx;/s);
});

test('成团记忆使用与专题板等比例的本地 JPEG 背景并保留渐变兜底', () => {
  const template = read('pages/discover/index.wxml');
  const style = read('pages/discover/index.wxss');
  const assetPath = path.join(root, 'assets/images/discover/formed-memory-editorial-bg.jpg');
  const asset = fs.readFileSync(assetPath);

  assert.match(template, /class="memory-panel-background"[^>]*src="\/assets\/images\/discover\/formed-memory-editorial-bg\.jpg"[^>]*mode="aspectFill"/);
  assert.match(template, /class="memory-panel-background-shade"/);
  assert.match(style, /\.memory-panel-background\s*\{[^}]*opacity:\s*0\.62;/s);
  assert.match(style, /\.memory-panel-background-shade\s*\{[^}]*linear-gradient/s);
  assert.deepEqual(Array.from(asset.subarray(0, 3)), [0xff, 0xd8, 0xff]);
  assert.ok(asset.length < 48 * 1024, '成团记忆背景应控制在 48KB 内');
});
