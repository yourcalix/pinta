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
  const navigateCalls = [];
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const originalGetApp = global.getApp;
  global.Page = (value) => { definition = value; };
  global.getApp = () => ({ globalData: { user: null, launchSplashShown: true } });
  global.wx = {
    getStorageSync: () => [],
    stopPullDownRefresh() {},
    navigateTo(options) { navigateCalls.push(options); },
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
    navigateCalls,
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

test('首页只请求并展示三条活动预览，不消费后续游标', async () => {
  const originalList = activityService.list;
  const calls = [];
  activityService.list = async (filters) => {
    calls.push(filters);
    return { items: ['a1', 'a2', 'a3'].map(dto), nextCursor: 'opaque-2' };
  };
  const context = loadDiscoverPage();
  try {
    await context.page.fetchActivities({ mode: 'replace' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cursor, undefined);
    assert.equal(calls[0].limit, 3);
    assert.deepEqual(context.page.data.activities.map((item) => item.id), ['a1', 'a2', 'a3']);
    assert.equal(Object.hasOwn(context.page.data, 'hasNextPage'), false);
    assert.equal(typeof context.page.handleLoadMore, 'undefined');
  } finally {
    activityService.list = originalList;
    unloadDiscoverPage(context);
  }
});

test('发现更多始终跳转全部活动页并阻止快速重复入栈', () => {
  const context = loadDiscoverPage();
  try {
    assert.equal(context.page.handleNavigateToAll(), true);
    assert.equal(context.page.handleNavigateToAll(), false);
    assert.equal(context.navigateCalls.length, 1);
    assert.equal(context.navigateCalls[0].url, '/subpackages/activity/list/index');
    context.navigateCalls[0].fail();
    assert.equal(context.page.handleNavigateToAll(), true);
  } finally {
    unloadDiscoverPage(context);
  }
});

test('切换活动类型会丢弃旧列表并加载新查询首页', async () => {
  const originalList = activityService.list;
  const calls = [];
  activityService.list = async (filters) => {
    calls.push(filters);
    return { items: [dto(filters.type || 'all')], nextCursor: null };
  };
  const context = loadDiscoverPage();
  try {
    context.page.setData({ activities: [dto('old')], loading: false, refreshing: false });
    await context.page.handleTypeChange({ currentTarget: { dataset: { value: 'sport' } } });
    assert.equal(calls[0].type, 'sport');
    assert.equal(calls[0].cursor, undefined);
    assert.equal(context.page.data.activities[0].id, 'sport');
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
    assert.equal(Object.hasOwn(context.page.data, 'hasNextPage'), false);
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

test('首页模板使用三条首屏加独立全部活动入口，彻底移除首页分页', () => {
  const template = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.wxml'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.js'), 'utf8');
  const config = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.json'), 'utf8');
  assert.match(template, /class="home-section-more"[^>]*bindtap="handleNavigateToAll"/);
  assert.match(template, />发现更多</);
  assert.match(template, /wx:for="\{\{\[1,2,3\]\}\}"/);
  assert.doesNotMatch(template, /isPaging|hasNextPage|bindtap="handleLoadMore"/);
  assert.doesNotMatch(script, /handleLoadMore|loadMoreActivities|hasNextPage|isPaging|_nextCursor|_pageCache|_pageCursors/);
  assert.doesNotMatch(config, /onReachBottomDistance/);
});

test('首页使用正式插画 Hero、锚定搜索浮层与温暖米白页面背景', () => {
  const template = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.wxml'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.wxss'), 'utf8');
  assert.match(template, /class="home-greeting"/);
  assert.match(template, /class="home-hero"/);
  assert.match(template, /class="hero-illustration-slot" aria-hidden="true"/);
  assert.match(template, /class="hero-search-floating-bar \{\{searchPanelVisible \? 'hero-search-floating-bar--visible' : ''\}\}"/);
  assert.match(template, /class="hero-search-backdrop" catchtap="handleCloseSearch"/);
  assert.match(style, /\.hero-search-floating-bar--visible\s*\{[^}]*visibility:\s*visible;[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;/s);
  assert.doesNotMatch(template, /home-directory-tools|filter-chip|<scroll-view/);
  assert.doesNotMatch(template, /hero-campus\.png|class="hero surface"/);
  assert.match(style, /\.home-page\s*\{[^}]*padding-bottom:\s*calc\(200rpx \+ env\(safe-area-inset-bottom\)\)[^}]*background:\s*#f9f7f2/s);
  assert.match(style, /\.home-hero\s*\{[^}]*height:\s*709rpx/s);
});

test('Hero 搜索按钮可展开与外部关闭且不改动正文布局状态', () => {
  const context = loadDiscoverPage();
  try {
    assert.equal(context.page.handleHeaderAction({ currentTarget: { dataset: { action: 'search' } } }), true);
    assert.equal(context.page.data.searchPanelVisible, true);
    assert.equal(context.page.handleCloseSearch(), true);
    assert.equal(context.page.data.searchPanelVisible, false);
    assert.equal(context.page.handleCloseSearch(), false);
  } finally {
    unloadDiscoverPage(context);
  }
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
