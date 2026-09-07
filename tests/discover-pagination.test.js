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
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  global.Page = (value) => { definition = value; };
  global.wx = {
    getStorageSync: () => [],
    stopPullDownRefresh() {},
    navigateTo() {},
    switchTab() {},
    showToast() {},
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
    originalSetTimeout,
    originalClearTimeout,
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
  global.setTimeout = context.originalSetTimeout;
  global.clearTimeout = context.originalClearTimeout;
}

test('发现页首屏与下一页每次只请求五条并透传不透明游标', async () => {
  const originalList = activityService.list;
  const calls = [];
  activityService.list = async (filters) => {
    calls.push(filters);
    if (!filters.cursor) return { items: ['a1', 'a2', 'a3', 'a4', 'a5'].map(dto), nextCursor: 'opaque-2' };
    return { items: [dto('a6'), dto('a7')], nextCursor: null };
  };
  const context = loadDiscoverPage();
  try {
    await context.page.fetchActivities({ mode: 'replace' });
    assert.equal(calls[0].cursor, undefined);
    assert.equal(calls[0].limit, 5);
    assert.equal(context.page.data.activities.length, 5);
    assert.equal(context.page.data.currentPage, 1);
    assert.equal(context.page.data.hasNextPage, true);
    await context.page.handleNextPage();
    assert.equal(calls[1].cursor, 'opaque-2');
    assert.equal(calls[1].limit, 5);
    assert.deepEqual(context.page.data.activities.map((item) => item.id), ['a6', 'a7']);
    assert.equal(context.page.data.currentPage, 2);
    assert.equal(context.page.data.hasNextPage, false);
    assert.equal(context.page._pageCache.length, 2);
    assert.deepEqual(context.scrollCalls.at(-1), { selector: '#hot-pinba-heading', duration: 200 });
  } finally {
    activityService.list = originalList;
    unloadDiscoverPage(context);
  }
});

test('replace 抢占晚到的下一页请求，旧页响应不能污染新筛选结果', async () => {
  const originalList = activityService.list;
  let resolveAppend;
  activityService.list = (filters) => {
    if (filters.cursor) return new Promise((resolve) => { resolveAppend = resolve; });
    return Promise.resolve({ items: [dto('replacement')], nextCursor: null });
  };
  const context = loadDiscoverPage();
  try {
    context.page._pageCache = [{ activities: [dto('old')], nextCursor: 'next' }];
    context.page._pageCursors = [undefined, 'next'];
    context.page.setData({ activities: [dto('old')], currentPage: 1, hasNextPage: true, hasPagination: true, loading: false, refreshing: false });
    const append = context.page.handleNextPage();
    const replace = context.page.fetchActivities({ mode: 'replace' });
    await replace;
    resolveAppend({ items: [dto('stale')], nextCursor: null });
    await append;
    assert.deepEqual(context.page.data.activities.map((item) => item.id), ['replacement']);
    assert.equal(context.page.data.currentPage, 1);
    assert.equal(context.page.data.isPaging, false);
  } finally {
    activityService.list = originalList;
    unloadDiscoverPage(context);
  }
});

test('下一页失败保留当前五张卡片并释放翻页锁', async () => {
  const originalList = activityService.list;
  activityService.list = async () => { throw new Error('raw transport error'); };
  const context = loadDiscoverPage();
  try {
    const kept = ['a1', 'a2', 'a3', 'a4', 'a5'].map(dto);
    context.page._pageCache = [{ activities: kept, nextCursor: 'next' }];
    context.page._pageCursors = [undefined, 'next'];
    context.page.setData({ activities: kept, currentPage: 1, hasNextPage: true, hasPagination: true, loading: false, refreshing: false });
    await context.page.handleNextPage();
    assert.deepEqual(context.page.data.activities.map((item) => item.id), ['a1', 'a2', 'a3', 'a4', 'a5']);
    assert.equal(context.page.data.activities.length, 5);
    assert.equal(context.page.data.currentPage, 1);
    assert.equal(context.page.data.isPaging, false);
    assert.equal(JSON.stringify(context.page.data).includes('raw transport'), false);
  } finally {
    activityService.list = originalList;
    unloadDiscoverPage(context);
  }
});

test('上一页和已缓存下一页均本地秒切且不重复请求', async () => {
  const originalList = activityService.list;
  let calls = 0;
  activityService.list = async (filters) => {
    calls += 1;
    return filters.cursor
      ? { items: [dto('p2')], nextCursor: null }
      : { items: [dto('p1')], nextCursor: 'page-2' };
  };
  const context = loadDiscoverPage();
  try {
    await context.page.fetchActivities({ mode: 'replace' });
    await context.page.handleNextPage();
    assert.equal(calls, 2);
    context.page.handlePrevPage();
    assert.equal(context.page.data.currentPage, 1);
    assert.equal(context.page.data.activities[0].id, 'p1');
    await context.page.handleNextPage();
    assert.equal(calls, 2);
    assert.equal(context.page.data.currentPage, 2);
    assert.equal(context.page.data.activities[0].id, 'p2');
  } finally {
    activityService.list = originalList;
    unloadDiscoverPage(context);
  }
});

test('快速双击下一页只发出一次请求', async () => {
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
    const first = context.page.handleNextPage();
    const second = context.page.handleNextPage();
    assert.equal(second, false);
    assert.equal(calls, 2);
    resolveNext({ items: [dto('p2')], nextCursor: null });
    await first;
    assert.equal(context.page.data.currentPage, 2);
  } finally {
    activityService.list = originalList;
    unloadDiscoverPage(context);
  }
});

test('切换活动类型会清空旧页缓存并回到新查询第一页', async () => {
  const originalList = activityService.list;
  const calls = [];
  activityService.list = async (filters) => {
    calls.push(filters);
    return { items: [dto(filters.type || 'all')], nextCursor: null };
  };
  const context = loadDiscoverPage();
  try {
    context.page._pageCache = [
      { activities: [dto('old-1')], nextCursor: 'old-next' },
      { activities: [dto('old-2')], nextCursor: null }
    ];
    context.page._pageCursors = [undefined, 'old-next'];
    context.page.setData({ activities: [dto('old-2')], currentPage: 2, hasNextPage: false, hasPagination: true, loading: false, refreshing: false });
    await context.page.handleTypeChange({ currentTarget: { dataset: { value: 'sport' } } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].type, 'sport');
    assert.equal(calls[0].cursor, undefined);
    assert.equal(context.page.data.currentPage, 1);
    assert.equal(context.page.data.activities[0].id, 'sport');
    assert.equal(context.page._pageCache.length, 1);
    assert.deepEqual(context.page._pageCursors, [undefined]);
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
    assert.equal(context.page.data.loading, false);
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

test('发现页模板提供无总页数的分页导航并移除触底追加', () => {
  const template = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.wxml'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.wxss'), 'utf8');
  assert.match(template, /class="discover-pagination"/);
  assert.match(template, /bindtap="handlePrevPage"/);
  assert.match(template, /bindtap="handleNextPage"/);
  assert.match(template, /第\s*\{\{currentPage\}\}\s*页/);
  assert.doesNotMatch(template, /共\s*\{\{|总页数|handleRetryLoadMore|loadingMore/);
  assert.match(style, /\.pagination-button\s*\{[^}]*min-height:\s*88rpx/s);
  const script = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.js'), 'utf8');
  const config = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.json'), 'utf8');
  assert.doesNotMatch(script, /onReachBottom\s*\(/);
  assert.doesNotMatch(config, /onReachBottomDistance/);
});

test('首页使用温暖生活方式 Hero、横向筛选与米白页面背景', () => {
  const template = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.wxml'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.wxss'), 'utf8');
  assert.match(template, /class="home-greeting"/);
  assert.match(template, /class="home-hero"/);
  assert.match(template, /你的搭子，/);
  assert.match(template, /<scroll-view[^>]*scroll-x/);
  assert.match(template, /enhanced="\{\{true\}\}"/);
  assert.match(template, /show-scrollbar="\{\{false\}\}"/);
  assert.match(template, /bindtap="handleClearKeyword"/);
  assert.doesNotMatch(template, /hero-campus\.png|brand-puzzle\.png|class="hero surface"/);
  assert.doesNotMatch(template, /class="global-page-background"|shared-paper-bg\.jpg/);
  assert.match(style, /\.home-page\s*\{[^}]*padding-bottom:\s*calc\(200rpx \+ env\(safe-area-inset-bottom\)\)[^}]*background:\s*#f9f7f2/s);
  assert.match(style, /\.search-clear-button\s*\{[^}]*width:\s*88rpx[^}]*height:\s*88rpx/s);
});

test('活动卡片发现变体采用规整现代白卡且不依赖旧积木品牌图', () => {
  const template = fs.readFileSync(path.join(root, 'miniprogram/components/activity-card/index.wxml'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'miniprogram/components/activity-card/index.wxss'), 'utf8');
  assert.match(template, /owner-avatar/);
  assert.match(template, /item\.ownerInitial/);
  assert.doesNotMatch(template, /brand-puzzle\.png|owner-puzzle/);
  assert.match(style, /\.activity-card--discover\s*\{[^}]*background:\s*#fff;[^}]*border:\s*1\.5rpx solid #efece6;[^}]*border-radius:\s*24rpx;/s);
  assert.match(style, /\.activity-card--pressed/);
});
