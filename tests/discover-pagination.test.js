'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const activityService = require('../miniprogram/services/activity');
const safetyService = require('../miniprogram/services/safety');
const {
  mergeActivitiesById,
  expirationSchedule
} = require('../miniprogram/utils/discover-list');

const root = path.join(__dirname, '..');

function dto(id, overrides = {}) {
  return {
    id,
    type: 'buddy',
    title: `活动 ${id}`,
    description: '',
    city: '上海',
    district: '杨浦区',
    placeLabel: '五角场',
    startsAt: '2026-08-25T10:00:00.000Z',
    deadlineAt: '2026-08-25T09:00:00.000Z',
    targetMembers: 3,
    memberCount: 1,
    status: 'RECRUITING',
    owner: { nickname: '发起者' },
    typeData: { category: '运动', costMode: 'AA', level: 'BEGINNER', equipment: '' },
    viewerRole: 'guest',
    ...overrides
  };
}

function loadDiscoverPage() {
  let definition;
  const timers = [];
  const scrollCalls = [];
  const toastCalls = [];
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const originalGetApp = global.getApp;
  global.Page = (value) => { definition = value; };
  global.getApp = () => ({ globalData: { user: null, launchSplashShown: true } });
  global.wx = {
    getStorageSync: () => [],
    stopPullDownRefresh() {},
    navigateTo() {},
    switchTab() {},
    showToast(options) { toastCalls.push(options); },
    pageScrollTo(options) { scrollCalls.push(options); }
  };
  global.setTimeout = (handler, delay) => {
    const timer = { handler, delay, cleared: false };
    timers.push(timer);
    return timer;
  };
  global.clearTimeout = (timer) => {
    if (timer) timer.cleared = true;
  };
  const pagePath = require.resolve('../miniprogram/pages/discover/index');
  delete require.cache[pagePath];
  require(pagePath);
  return {
    pagePath,
    timers,
    scrollCalls,
    toastCalls,
    originalSetTimeout,
    originalClearTimeout,
    originalGetApp,
    page: {
      ...definition,
      data: { ...definition.data },
      setData(value) { Object.assign(this.data, value); }
    }
  };
}

function unloadDiscoverPage(context) {
  delete require.cache[context.pagePath];
  delete global.Page;
  delete global.wx;
  if (context.originalGetApp === undefined) delete global.getApp;
  else global.getApp = context.originalGetApp;
  global.setTimeout = context.originalSetTimeout;
  global.clearTimeout = context.originalClearTimeout;
}

test('首页首屏与查看更多每次请求三条并把新活动追加到现有列表', async () => {
  const originalList = activityService.list;
  const calls = [];
  activityService.list = async (filters) => {
    calls.push(filters);
    if (!filters.cursor) return { items: ['a1', 'a2', 'a3'].map(dto), nextCursor: 'opaque-2' };
    return { items: [dto('a4'), dto('a5')], nextCursor: null };
  };
  const context = loadDiscoverPage();
  try {
    await context.page.fetchActivities({ mode: 'replace' });
    assert.equal(calls[0].cursor, undefined);
    assert.equal(calls[0].limit, 3);
    assert.deepEqual(context.page.data.activities.map((item) => item.id), ['a1', 'a2', 'a3']);
    assert.equal(context.page.data.hasNextPage, true);
    await context.page.handleLoadMore();
    assert.equal(calls[1].cursor, 'opaque-2');
    assert.equal(calls[1].limit, 3);
    assert.deepEqual(context.page.data.activities.map((item) => item.id), ['a1', 'a2', 'a3', 'a4', 'a5']);
    assert.equal(context.page.data.hasNextPage, false);
    assert.deepEqual(context.scrollCalls, []);
  } finally {
    activityService.list = originalList;
    unloadDiscoverPage(context);
  }
});

test('replace 抢占晚到的查看更多请求，旧响应不能污染新筛选结果', async () => {
  const originalList = activityService.list;
  let resolveAppend;
  activityService.list = (filters) => {
    if (filters.cursor) return new Promise((resolve) => { resolveAppend = resolve; });
    return Promise.resolve({ items: [dto('replacement')], nextCursor: null });
  };
  const context = loadDiscoverPage();
  try {
    context.page._nextCursor = 'next';
    context.page.setData({ activities: [dto('old')], hasNextPage: true, loading: false, refreshing: false });
    const append = context.page.handleLoadMore();
    const replace = context.page.fetchActivities({ mode: 'replace' });
    await replace;
    resolveAppend({ items: [dto('stale')], nextCursor: null });
    await append;
    assert.deepEqual(context.page.data.activities.map((item) => item.id), ['replacement']);
    assert.equal(context.page.data.isPaging, false);
  } finally {
    activityService.list = originalList;
    unloadDiscoverPage(context);
  }
});

test('查看更多失败保留当前三张卡片并释放加载锁', async () => {
  const originalList = activityService.list;
  activityService.list = async () => { throw new Error('raw transport error'); };
  const context = loadDiscoverPage();
  try {
    const kept = ['a1', 'a2', 'a3'].map(dto);
    context.page._nextCursor = 'next';
    context.page.setData({ activities: kept, hasNextPage: true, loading: false, refreshing: false });
    await context.page.handleLoadMore();
    assert.deepEqual(context.page.data.activities.map((item) => item.id), ['a1', 'a2', 'a3']);
    assert.equal(context.page.data.isPaging, false);
    assert.equal(JSON.stringify(context.page.data).includes('raw transport'), false);
    assert.equal(context.toastCalls.at(-1).title, '加载失败，请重试');
  } finally {
    activityService.list = originalList;
    unloadDiscoverPage(context);
  }
});

test('快速双击查看更多只发出一次请求', async () => {
  const originalList = activityService.list;
  let resolveNext;
  let calls = 0;
  activityService.list = (filters) => {
    calls += 1;
    if (!filters.cursor) return Promise.resolve({ items: [dto('p1')], nextCursor: 'page-2' });
    return new Promise((resolve) => { resolveNext = resolve; });
  };
  const context = loadDiscoverPage();
  try {
    await context.page.fetchActivities({ mode: 'replace' });
    const first = context.page.handleLoadMore();
    const second = context.page.handleLoadMore();
    assert.equal(second, false);
    assert.equal(calls, 2);
    resolveNext({ items: [dto('p2')], nextCursor: null });
    await first;
    assert.deepEqual(context.page.data.activities.map((item) => item.id), ['p1', 'p2']);
  } finally {
    activityService.list = originalList;
    unloadDiscoverPage(context);
  }
});

test('切换活动类型会丢弃旧列表和旧游标并加载新查询首页', async () => {
  const originalList = activityService.list;
  const calls = [];
  activityService.list = async (filters) => {
    calls.push(filters);
    return { items: [dto(filters.type || 'all')], nextCursor: null };
  };
  const context = loadDiscoverPage();
  try {
    context.page._nextCursor = 'old-next';
    context.page.setData({ activities: [dto('old')], hasNextPage: true, loading: false, refreshing: false });
    await context.page.handleTypeChange({ currentTarget: { dataset: { value: 'sport' } } });
    assert.equal(calls[0].type, 'sport');
    assert.equal(calls[0].cursor, undefined);
    assert.equal(context.page.data.activities[0].id, 'sport');
    assert.equal(context.page._nextCursor, undefined);
  } finally {
    activityService.list = originalList;
    unloadDiscoverPage(context);
  }
});

test('举报隐藏导致空页时最多自动补拉一次，避免无界递归', async () => {
  const originalList = activityService.list;
  const originalFilter = safetyService.filterHiddenActivities;
  let calls = 0;
  activityService.list = async () => {
    calls += 1;
    return { items: [dto(`hidden-${calls}`)], nextCursor: `opaque-${calls}` };
  };
  safetyService.filterHiddenActivities = () => [];
  const context = loadDiscoverPage();
  try {
    await context.page.fetchActivities({ mode: 'replace' });
    assert.equal(calls, 2);
    assert.deepEqual(context.page.data.activities, []);
    assert.equal(context.page.data.hasNextPage, true);
  } finally {
    activityService.list = originalList;
    safetyService.filterHiddenActivities = originalFilter;
    unloadDiscoverPage(context);
  }
});

test('页面卸载后丢弃晚到的列表响应且清除截止计时器', async () => {
  const originalList = activityService.list;
  let resolveList;
  activityService.list = () => new Promise((resolve) => { resolveList = resolve; });
  const context = loadDiscoverPage();
  try {
    const request = context.page.fetchActivities({ mode: 'replace' });
    context.page.onUnload();
    resolveList({ items: [dto('late')], nextCursor: null });
    await request;
    assert.deepEqual(context.page.data.activities, []);
    assert.equal(context.page._expirationTimer, null);
  } finally {
    activityService.list = originalList;
    unloadDiscoverPage(context);
  }
});

test('列表工具按 ID 合并且截止计时严格限制在 1 秒到 1 小时', () => {
  assert.deepEqual(
    mergeActivitiesById([dto('a1'), dto('a2')], [dto('a2', { title: '更新' }), dto('a3')]).map((item) => item.id),
    ['a1', 'a2', 'a3']
  );
  const now = Date.parse('2026-08-24T08:00:00.000Z');
  assert.equal(expirationSchedule([dto('past', { deadlineAt: '2026-08-24T07:00:00.000Z' })], now).delay, 1000);
  assert.equal(expirationSchedule([dto('far', { deadlineAt: '2026-08-25T08:00:00.000Z' })], now).delay, 3600000);
  assert.equal(expirationSchedule([dto('formed', { status: 'FORMED' })], now), null);
});

test('首页模板使用三条首屏加查看更多，彻底移除旧离散分页', () => {
  const template = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.wxml'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.js'), 'utf8');
  const config = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.json'), 'utf8');
  assert.match(template, /class="load-more-heading/);
  assert.match(template, /bindtap="handleLoadMore"/);
  assert.match(template, /wx:for="\{\{\[1,2,3\]\}\}"/);
  assert.doesNotMatch(template, /discover-pagination|handlePrevPage|handleNextPage|currentPage/);
  assert.doesNotMatch(script, /onReachBottom\s*\(|_pageCache|_pageCursors/);
  assert.doesNotMatch(config, /onReachBottomDistance/);
});

test('首页使用正式插画 Hero、按需检索面板与温暖米白页面背景', () => {
  const template = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.wxml'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.wxss'), 'utf8');
  assert.match(template, /class="home-greeting"/);
  assert.match(template, /class="home-hero"/);
  assert.match(template, /class="hero-illustration-slot" aria-hidden="true"/);
  assert.match(template, /id="home-directory-tools" class="directory-tools \{\{searchPanelVisible \? 'directory-tools--expanded' : ''\}\}"/);
  assert.match(style, /\.directory-tools--expanded\s*\{[^}]*max-height:\s*240rpx[^}]*pointer-events:\s*auto/s);
  assert.match(template, /<scroll-view[^>]*scroll-x/);
  assert.doesNotMatch(template, /hero-campus\.png|class="hero surface"/);
  assert.match(style, /\.home-page\s*\{[^}]*padding-bottom:\s*calc\(200rpx \+ env\(safe-area-inset-bottom\)\)[^}]*background:\s*#f9f7f2/s);
  assert.match(style, /\.home-hero\s*\{[^}]*height:\s*709rpx/s);
});

test('首页在系统大字设置下将三列活动卡切换为单列可读模式', () => {
  const context = loadDiscoverPage();
  try {
    global.wx.getAppBaseInfo = () => ({ fontSizeSetting: 20 });
    assert.equal(context.page.syncTextSizeMode(), true);
    assert.equal(context.page.data.largeTextMode, true);
    global.wx.getAppBaseInfo = () => ({ fontSizeSetting: 16 });
    assert.equal(context.page.syncTextSizeMode(), false);
    assert.equal(context.page.data.largeTextMode, false);
  } finally {
    unloadDiscoverPage(context);
  }
});

test('活动卡片首页预览变体采用规整三列白卡且不依赖旧积木品牌图', () => {
  const template = fs.readFileSync(path.join(root, 'miniprogram/components/activity-card/index.wxml'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'miniprogram/components/activity-card/index.wxss'), 'utf8');
  assert.match(template, /owner-avatar/);
  assert.match(template, /item\.ownerInitial/);
  assert.doesNotMatch(template, /brand-puzzle\.png|owner-puzzle/);
  assert.match(style, /\.activity-card--home-preview\s*\{[^}]*width:\s*100%;[^}]*height:\s*275rpx;[^}]*background:\s*#fff;[^}]*border:\s*1\.5rpx solid #efece6;[^}]*border-radius:\s*22rpx;/s);
  assert.match(style, /\.activity-card--pressed/);
});
