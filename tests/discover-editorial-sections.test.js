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
    assert.equal(context.page.data.hasMoreMemories, true);
    context.page.handleToggleMemories();
    assert.equal(context.page.data.visibleMemories.length, 4);
    assert.equal(context.page.data.memoriesExpanded, true);
  } finally {
    activityService.memories = originalMemories;
    unload(context);
  }
});
