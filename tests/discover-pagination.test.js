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
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  global.Page = (value) => { definition = value; };
  global.wx = {
    getStorageSync: () => [],
    stopPullDownRefresh() {},
    navigateTo() {},
    switchTab() {},
    showToast() {}
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

test('发现页 replace 不传游标、append 原样透传游标并按 ID 去重', async () => {
  const originalList = activityService.list;
  const calls = [];
  activityService.list = async (filters) => {
    calls.push(filters);
    if (!filters.cursor) return { items: [dto('a1'), dto('a2')], nextCursor: 'opaque-2' };
    return { items: [dto('a2'), dto('a3')], nextCursor: null };
  };
  const context = loadDiscoverPage();
  try {
    await context.page.fetchActivities({ mode: 'replace' });
    await context.page.fetchActivities({ mode: 'append' });
    assert.equal(calls[0].cursor, undefined);
    assert.equal(calls[0].limit, 10);
    assert.equal(calls[1].cursor, 'opaque-2');
    assert.deepEqual(context.page.data.activities.map((item) => item.id), ['a1', 'a2', 'a3']);
    assert.equal(context.page.data.hasMore, false);
  } finally {
    activityService.list = originalList;
    unloadDiscoverPage(context);
  }
});

test('replace 抢占晚到的 append，旧页响应不能污染新筛选结果', async () => {
  const originalList = activityService.list;
  let resolveAppend;
  activityService.list = (filters) => {
    if (filters.cursor) return new Promise((resolve) => { resolveAppend = resolve; });
    return Promise.resolve({ items: [dto('replacement')], nextCursor: null });
  };
  const context = loadDiscoverPage();
  try {
    context.page.setData({
      activities: [dto('old')],
      nextCursor: 'next',
      hasMore: true,
      loading: false,
      refreshing: false
    });
    const append = context.page.fetchActivities({ mode: 'append' });
    const replace = context.page.fetchActivities({ mode: 'replace' });
    await replace;
    resolveAppend({ items: [dto('stale')], nextCursor: null });
    await append;
    assert.deepEqual(context.page.data.activities.map((item) => item.id), ['replacement']);
    assert.equal(context.page.data.loadingMore, false);
  } finally {
    activityService.list = originalList;
    unloadDiscoverPage(context);
  }
});

test('append 失败保留已有卡片并进入可重试页尾状态', async () => {
  const originalList = activityService.list;
  activityService.list = async () => { throw new Error('raw transport error'); };
  const context = loadDiscoverPage();
  try {
    context.page.setData({
      activities: [dto('kept')],
      nextCursor: 'next',
      hasMore: true,
      loading: false,
      refreshing: false
    });
    await context.page.fetchActivities({ mode: 'append' });
    assert.deepEqual(context.page.data.activities.map((item) => item.id), ['kept']);
    assert.equal(context.page.data.loadingMore, false);
    assert.equal(context.page.data.loadMoreError, '加载更多失败，请重试');
    assert.equal(JSON.stringify(context.page.data).includes('raw transport'), false);
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
    assert.equal(context.page.data.hasMore, true);
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

test('发现页模板提供互斥页尾状态与 44px 重试热区', () => {
  const template = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.wxml'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.wxss'), 'utf8');
  assert.match(template, /loadingMore/);
  assert.match(template, /loadMoreError/);
  assert.match(template, /!hasMore/);
  assert.match(template, /bindtap="handleRetryLoadMore"/);
  assert.match(style, /\.footer-retry-button[\s\S]*min-height:\s*88rpx/);
});

test('发现页使用深蓝纸纹、紧凑标题和可横滑类型筛选，不再渲染旧校园 Hero', () => {
  const template = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.wxml'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.wxss'), 'utf8');
  assert.match(template, /publish-paper-texture\.webp/);
  assert.match(template, /拼吧 · 发现/);
  assert.match(template, /<scroll-view[^>]*scroll-x/);
  assert.match(template, /enhanced="\{\{true\}\}"/);
  assert.match(template, /show-scrollbar="\{\{false\}\}"/);
  assert.match(template, /bindtap="handleClearKeyword"/);
  assert.doesNotMatch(template, /hero-campus\.png|brand-puzzle\.png|class="hero surface"/);
  assert.match(style, /\.discover-paper-background/);
  assert.match(style, /background:\s*#075aa7/i);
  assert.match(style, /\.search-clear-button[\s\S]*min-(?:width|height):\s*88rpx/);
  assert.match(style, /\.search-clear-button[^}]*margin-right:\s*12rpx/);
});

test('活动卡片采用奶油白紧凑结构且不依赖旧积木品牌图', () => {
  const template = fs.readFileSync(path.join(root, 'miniprogram/components/activity-card/index.wxml'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'miniprogram/components/activity-card/index.wxss'), 'utf8');
  assert.match(template, /owner-avatar/);
  assert.match(template, /item\.ownerInitial/);
  assert.doesNotMatch(template, /brand-puzzle\.png|owner-puzzle/);
  assert.match(style, /background:\s*#fff8ee/i);
  assert.match(style, /\.activity-card--pressed/);
});
