'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const activityService = require('../miniprogram/services/activity');
const root = path.join(__dirname, '../miniprogram');

function dto(id, overrides = {}) {
  return {
    id,
    type: 'buddy',
    title: `活动 ${id}`,
    description: '真实活动说明',
    city: '澳门',
    district: '氹仔',
    placeLabel: '运动场',
    startsAt: '2026-09-12T10:00:00.000Z',
    deadlineAt: '2026-09-12T09:00:00.000Z',
    targetMembers: 4,
    memberCount: 1,
    status: 'RECRUITING',
    owner: { nickname: '小拼' },
    typeData: { category: '羽毛球', venue: '运动场' },
    viewerRole: 'guest',
    ...overrides
  };
}

function loadPage() {
  let definition;
  const navigateCalls = [];
  const switchCalls = [];
  const originalGetApp = global.getApp;
  global.Page = (value) => { definition = value; };
  global.wx = {
    getAppBaseInfo: () => ({ fontSizeSetting: 16 }),
    stopPullDownRefresh() {},
    navigateTo(options) { navigateCalls.push(options); },
    switchTab(options) { switchCalls.push(options); },
    showToast() {}
  };
  const pagePath = require.resolve('../miniprogram/subpackages/activity/list/index');
  delete require.cache[pagePath];
  require(pagePath);
  return {
    pagePath,
    navigateCalls,
    switchCalls,
    originalGetApp,
    page: {
      ...definition,
      data: { ...definition.data },
      setData(value) { Object.assign(this.data, value); }
    }
  };
}

function unloadPage(context) {
  context.page.clearExpirationTimer();
  delete require.cache[context.pagePath];
  delete global.Page;
  delete global.wx;
  if (context.originalGetApp === undefined) delete global.getApp;
  else global.getApp = context.originalGetApp;
}

test('全部活动页注册在活动分包并使用原生标题栏', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const activityPackage = app.subPackages.find((item) => item.root === 'subpackages/activity');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'subpackages/activity/list/index.json'), 'utf8'));
  assert.ok(activityPackage.pages.includes('list/index'));
  assert.equal(config.navigationBarTitleText, '全部活动');
  assert.equal(config.enablePullDownRefresh, true);
  assert.equal(config.onReachBottomDistance, 160);
});

test('全部活动页包含搜索、真实类型筛选、画报卡和完整列表状态', () => {
  const template = fs.readFileSync(path.join(root, 'subpackages/activity/list/index.wxml'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'subpackages/activity/list/index.wxss'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'subpackages/activity/list/index.js'), 'utf8');
  const componentTemplate = fs.readFileSync(path.join(root, 'components/activity-card/index.wxml'), 'utf8');
  assert.match(template, /role="search"/);
  assert.match(script, /label: '全部'[\s\S]*label: '拼同行'[\s\S]*label: '拼运动'[\s\S]*label: '拼饭桌'/);
  assert.match(template, /variant="discover"/);
  assert.match(template, /loadingMore \|\| loadMoreError \|\| !hasMore/);
  assert.match(template, /已经到底啦 · 拼吧/);
  assert.match(style, /\.activity-search\s*\{[^}]*height:\s*68rpx;[^}]*border-radius:\s*34rpx/s);
  assert.match(style, /\.activity-filter-chip\s*\{[^}]*height:\s*54rpx/s);
  assert.match(style, /@media \(max-width:\s*340px\)[\s\S]*\.activity-search\s*\{[^}]*height:\s*60rpx/s);
  assert.match(componentTemplate, /variant === 'discover'/);
  assert.match(componentTemplate, /class="activity-card activity-card--discover/);
});

test('全部活动页按十条游标分页并按 ID 去重追加', async () => {
  const originalList = activityService.list;
  const calls = [];
  activityService.list = async (filters) => {
    calls.push(filters);
    if (!filters.cursor) return { items: [dto('a1'), dto('a2')], nextCursor: 'opaque-next' };
    return { items: [dto('a2', { title: '更新后的活动' }), dto('a3')], nextCursor: null };
  };
  const context = loadPage();
  try {
    await context.page.fetchActivities({ mode: 'replace' });
    assert.equal(calls[0].limit, 10);
    assert.equal(calls[0].cursor, undefined);
    assert.deepEqual(context.page.data.activities.map((item) => item.id), ['a1', 'a2']);
    assert.equal(context.page.data.hasMore, true);
    await context.page.onReachBottom();
    assert.equal(calls[1].cursor, 'opaque-next');
    assert.deepEqual(context.page.data.activities.map((item) => item.id), ['a1', 'a2', 'a3']);
    assert.equal(context.page.data.activities[1].title, '更新后的活动');
    assert.equal(context.page.data.hasMore, false);
  } finally {
    activityService.list = originalList;
    unloadPage(context);
  }
});

test('全部活动页筛选重置游标，续页失败保留已有内容并可重试', async () => {
  const originalList = activityService.list;
  const calls = [];
  activityService.list = async (filters) => {
    calls.push(filters);
    if (filters.cursor) throw new Error('raw failure');
    return { items: [dto(filters.type || 'all')], nextCursor: 'next-page' };
  };
  const context = loadPage();
  try {
    await context.page.fetchActivities({ mode: 'replace' });
    await context.page.loadMoreActivities();
    assert.deepEqual(context.page.data.activities.map((item) => item.id), ['all']);
    assert.equal(context.page.data.loadingMore, false);
    assert.equal(context.page.data.loadMoreError, '加载更多失败，点击重试');
    await context.page.handleTypeChange({ currentTarget: { dataset: { value: 'sport' } } });
    assert.equal(calls.at(-1).type, 'sport');
    assert.equal(calls.at(-1).cursor, undefined);
    assert.equal(context.page.data.loadMoreError, '');
    assert.equal(context.page.data.activities[0].id, 'sport');
  } finally {
    activityService.list = originalList;
    unloadPage(context);
  }
});

test('全部活动卡点击进入既有详情，空态发起入口切至发布 Tab', () => {
  const context = loadPage();
  try {
    context.page.handleCardSelect({ detail: { id: 'activity/1' } });
    assert.equal(context.navigateCalls[0].url, '/subpackages/activity/detail/index?id=activity%2F1');
    assert.equal(context.page.handleEmptyAction(), true);
    assert.equal(context.switchCalls[0].url, '/pages/publish/index');
  } finally {
    unloadPage(context);
  }
});
