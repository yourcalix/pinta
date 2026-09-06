'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const activityService = require('../miniprogram/services/activity');

const root = path.join(__dirname, '../miniprogram');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function dto(id) {
  return {
    id,
    type: 'sport',
    title: `成团活动 ${id}`,
    city: '澳门',
    district: '澳门校园',
    placeLabel: '附近体育馆',
    startsAt: '2026-09-05T10:00:00.000Z',
    deadlineAt: '2026-09-05T09:00:00.000Z',
    minMembers: 2,
    maxMembers: 4,
    memberCount: 4,
    status: 'FORMED',
    owner: { nickname: '小拼' },
    ownerProfile: { avatar: { kind: 'DEFAULT', fallback: 'MALE_DEFAULT' } },
    avatarSlots: [],
    typeData: { category: '羽毛球', venue: '附近体育馆' },
    formedAt: '2026-09-05T08:00:00.000Z'
  };
}

function loadPage() {
  let definition;
  global.Page = (value) => { definition = value; };
  global.wx = {
    getStorageSync: () => [],
    navigateTo() {},
    switchTab() {},
    stopPullDownRefresh() {},
    showToast() {}
  };
  const pagePath = require.resolve('../miniprogram/pages/discover/index');
  delete require.cache[pagePath];
  require(pagePath);
  return {
    pagePath,
    page: {
      ...definition,
      data: { ...definition.data },
      setData(value) { Object.assign(this.data, value); }
    }
  };
}

function unload(context) {
  delete require.cache[context.pagePath];
  delete global.Page;
  delete global.wx;
}

test('发现页按 Banner、搜索、筛选、活动流、成团记忆顺序渲染', () => {
  const template = read('pages/discover/index.wxml');
  const markers = ['campaign-swiper', 'search-row', 'filter-scroll', 'list-heading', 'memory-section'];
  const positions = markers.map((marker) => template.indexOf(marker));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(template, /autoplay="{{banners\.length > 1}}"/);
  assert.match(template, /interval="4500"/);
  assert.match(template, /duration="400"/);
  assert.match(template, /wx:if="{{memories\.length}}"[^>]*class="memory-section/s);
});

test('发现页 Banner 和成团记忆使用既有 PNG、受控跳转与 1+2 拼贴样式', () => {
  const script = read('pages/discover/index.js');
  const style = read('pages/discover/index.wxss');
  assert.match(script, /publish-cover-companion\.png/);
  assert.match(script, /publish-cover-sport\.png/);
  assert.match(script, /publish-cover-food\.png/);
  assert.doesNotMatch(script, /\.webp/);
  assert.match(script, /BANNER_ROUTE_WHITELIST/);
  assert.match(style, /\.campaign-swiper\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*7;/s);
  assert.match(style, /\.memory-grid--3[\s\S]*grid-template-columns/);
  assert.match(style, /\.memory-card::after[\s\S]*linear-gradient/);
  assert.match(style, /@media \(max-width: 340px\)[\s\S]*\.campaign-swiper/);
});

test('成团记忆严格采用参考式居中标题、亮蓝画报、左大右双与黄色按钮', () => {
  const template = read('pages/discover/index.wxml');
  const style = read('pages/discover/index.wxss');
  assert.match(template, /class="memory-heading-watermark"[^>]*>FORMED STORIES/);
  assert.match(template, /class="memory-title">成团记忆/);
  assert.match(template, /class="memory-panel memory-panel--layout-\{\{memoryLayout\}\} \{\{memoriesExpanded \? 'memory-panel--expanded' : ''\}\}"/);
  assert.match(template, /class="memory-camera"/);
  assert.match(template, /class="memory-art-title-first">分享你的/);
  assert.match(template, /class="memory-panel-masthead-accent">成团/);
  assert.match(template, /featuredMemories\.length < 2[^>]*class="memory-placeholder memory-placeholder--top"/);
  assert.match(template, /featuredMemories\.length < 3[^>]*class="memory-placeholder memory-placeholder--bottom"/);
  assert.match(template, /memory-card-copy--\{\{item\.memoryPosition\}\}/);
  assert.match(template, /wx:if="\{\{memoryLayout !== 3 \|\| item\.memoryPosition === 'lead'\}\}" class="memory-owner-row"/);
  assert.match(template, /class="memory-more-button"[\s\S]*\{\{memoriesExpanded \? '收起成团记忆' : '查看更多'\}\}/);

  assert.match(style, /\.memory-section-heading\s*\{[^}]*position:\s*relative;[^}]*height:\s*100rpx;[^}]*text-align:\s*center;/s);
  assert.match(style, /\.memory-heading-watermark\s*\{[^}]*font-size:\s*26rpx;[^}]*letter-spacing:\s*4rpx;/s);
  assert.match(style, /\.memory-panel\s*\{[^}]*padding:\s*24rpx;[^}]*background:\s*linear-gradient\(180deg,\s*#4fa4f8 0%,\s*#207be5 100%\)/is);
  assert.match(style, /\.memory-panel\s*\{[^}]*margin-bottom:\s*24rpx;/s);
  assert.match(style, /\.memory-art::before\s*\{[^}]*radial-gradient\(circle at 65% 40%/s);
  assert.match(style, /\.memory-art-title\s*\{[^}]*text-shadow:[^}]*transform:\s*rotate\(-3deg\);/s);
  assert.match(style, /\.memory-art-title-first\s*\{[^}]*font-size:\s*42rpx;/s);
  assert.match(style, /\.memory-art-title-second\s*\{[^}]*font-size:\s*52rpx;/s);
  assert.match(style, /\.memory-grid--3\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[^}]*grid-template-rows:\s*286rpx 286rpx;/s);
  assert.match(style, /\.memory-grid--3 \.memory-card--lead\s*\{[^}]*grid-row:\s*1 \/ 3;[^}]*height:\s*588rpx;/s);
  assert.match(style, /\.memory-placeholder\s*\{[^}]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.12\);[^}]*border:\s*2rpx dashed rgba\(255,\s*255,\s*255,\s*0\.35\);[^}]*pointer-events:\s*none;/s);
  assert.match(style, /\.memory-card::after\s*\{[^}]*rgba\(0,\s*0,\s*0,\s*0\.85\) 100%/s);
  assert.match(style, /\.memory-more-button\s*\{[^}]*min-height:\s*88rpx;[^}]*color:\s*#111827;[^}]*background:\s*#ffc72c;/s);
  assert.match(style, /@media \(max-width:\s*340px\)[\s\S]*\.memory-grid--3\s*\{[^}]*grid-template-rows:\s*248rpx 248rpx;/s);
  assert.match(style, /@media \(max-width:\s*340px\)[\s\S]*\.memory-grid--3 \.memory-card--lead\s*\{[^}]*height:\s*508rpx;/s);
});

test('成团记忆专题板保持参考图纵向比例并允许展开内容自然增高', () => {
  const template = read('pages/discover/index.wxml');
  const style = read('pages/discover/index.wxss');
  assert.match(template, /memoriesExpanded \? 'memory-panel--expanded' : ''/);
  assert.match(style, /\.memory-panel\s*\{[^}]*min-height:\s*860rpx;[^}]*aspect-ratio:\s*347\s*\/\s*430;/s);
  assert.match(style, /\.memory-panel--expanded\s*\{[^}]*aspect-ratio:\s*auto;/s);
  assert.match(style, /\.memory-panel-masthead\s*\{[^}]*min-height:\s*196rpx;/s);
  assert.match(style, /\.memory-grid--1 \.memory-card\s*\{[^}]*height:\s*600rpx;/s);
  assert.match(style, /\.memory-grid--2 \.memory-card\s*\{[^}]*height:\s*600rpx;/s);
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

test('成团记忆独立加载，失败不污染活动列表且离屏晚到响应失效', async () => {
  const originalMemories = activityService.memories;
  let resolveLate;
  const context = loadPage();
  try {
    activityService.memories = async () => { throw new Error('memory failed'); };
    context.page.setData({ activities: [dto('active')], error: '' });
    await context.page.fetchMemories();
    assert.deepEqual(context.page.data.activities.map((item) => item.id), ['active']);
    assert.deepEqual(context.page.data.memories, []);
    assert.equal(context.page.data.error, '');

    activityService.memories = () => new Promise((resolve) => { resolveLate = resolve; });
    const request = context.page.fetchMemories();
    context.page.onHide();
    resolveLate({ items: [dto('late')] });
    await request;
    assert.deepEqual(context.page.data.memories, []);
  } finally {
    activityService.memories = originalMemories;
    unload(context);
  }
});

test('成团记忆最多展示三条并可在本页展开剩余真实记录', async () => {
  const originalMemories = activityService.memories;
  activityService.memories = async () => ({ items: ['1', '2', '3', '4'].map(dto) });
  const context = loadPage();
  try {
    await context.page.fetchMemories();
    assert.equal(context.page.data.visibleMemories.length, 3);
    assert.equal(context.page.data.memoryLayout, 3);
    assert.equal(context.page.data.hasMoreMemories, true);
    context.page.handleToggleMemories();
    assert.equal(context.page.data.visibleMemories.length, 4);
    assert.equal(context.page.data.memoriesExpanded, true);
  } finally {
    activityService.memories = originalMemories;
    unload(context);
  }
});
