'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const activityService = require('../miniprogram/services/activity');

const root = path.join(__dirname, '..');

function loadDiscoverPage(appGlobalData = { launchSplashShown: false }) {
  let definition;
  const timers = [];
  const tabBar = { hidden: 0, shown: 0 };
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const originalGetApp = global.getApp;
  global.Page = (value) => { definition = value; };
  global.getApp = () => ({ globalData: appGlobalData });
  global.wx = {
    getStorageSync: () => [],
    stopPullDownRefresh() {},
    navigateTo() {},
    switchTab() {},
    showToast() {},
    hideTabBar() { tabBar.hidden += 1; },
    showTabBar() { tabBar.shown += 1; }
  };
  global.setTimeout = (handler, delay) => {
    const timer = { handler, delay, cleared: false, ran: false };
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
    tabBar,
    appGlobalData,
    originalSetTimeout,
    originalClearTimeout,
    originalGetApp,
    page: {
      ...definition,
      data: JSON.parse(JSON.stringify(definition.data)),
      setData(value) { Object.assign(this.data, value); }
    }
  };
}

function runTimer(timer) {
  if (!timer || timer.cleared || timer.ran) return;
  timer.ran = true;
  timer.handler();
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

test('启动进度采用 12 格透视坐标，并以 3.8 秒门限组织约 5 秒时间轴', () => {
  const progress = require('../miniprogram/utils/launch-progress');
  assert.equal(progress.TOTAL_BLOCKS, 12);
  assert.equal(progress.PRELOAD_BLOCKS, 10);
  assert.equal(progress.STEP_INTERVAL_MS, 320);
  assert.equal(progress.FINISH_GATE_MS, 3800);
  assert.equal(progress.FINISH_INTERVAL_MS, 220);
  assert.equal(progress.DROP_DURATION_MS, 360);
  assert.equal(progress.HOLD_MS, 120);
  assert.equal(progress.FADE_MS, 500);
  const blocks = progress.createProgressBlocks();
  assert.equal(blocks.length, 12);
  assert.deepEqual(blocks[0], { id: 1, x: 24, y: 108, scale: 1, zIndex: 12 });
  assert.deepEqual(blocks[11], { id: 12, x: 398, y: 20, scale: 0.868, zIndex: 1 });
});

test('快速首屏请求也等待预进度完成，再补齐 100% 并恢复 TabBar', async () => {
  const originalList = activityService.list;
  activityService.list = async () => ({ items: [], nextCursor: null });
  const context = loadDiscoverPage();
  try {
    const loading = context.page.onLoad();
    await loading;
    assert.equal(context.page.data.launchSplashVisible, true);
    assert.equal(context.page.data.launchProgress, 0);
    assert.equal(context.appGlobalData.launchSplashShown, true);
    assert.equal(context.tabBar.hidden, 1);
    assert.equal(context.tabBar.shown, 0);

    context.timers.filter((timer) => timer.delay < 3800).forEach(runTimer);
    assert.equal(context.page.data.launchProgress, 10);
    assert.equal(context.page.data.launchSplashVisible, true);
    assert.equal(context.timers.length, 11);

    runTimer(context.timers.find((timer) => timer.delay === 3800));
    const finishTimers = context.timers.filter((timer) => !timer.ran).sort((left, right) => left.delay - right.delay);
    assert.deepEqual(finishTimers.map((timer) => timer.delay), [0, 220, 700, 1200]);
    finishTimers.forEach(runTimer);
    assert.equal(context.page.data.launchProgress, 12);
    assert.equal(context.page.data.launchSplashVisible, false);
    assert.equal(context.tabBar.shown, 1);
    assert.equal(context.page.startLaunchSplash(), false);
  } finally {
    activityService.list = originalList;
    unloadDiscoverPage(context);
  }
});

test('数据未完成时进度停在 10 格，结束后才允许补齐', async () => {
  const originalList = activityService.list;
  let resolveList;
  activityService.list = () => new Promise((resolve) => { resolveList = resolve; });
  const context = loadDiscoverPage();
  try {
    const loading = context.page.onLoad();
    context.timers.filter((timer) => timer.delay <= 3800).forEach(runTimer);
    assert.equal(context.page.data.launchProgress, 10);
    assert.equal(context.timers.length, 11);

    resolveList({ items: [], nextCursor: null });
    await loading;
    assert.equal(context.timers.length, 15);
    context.timers.filter((timer) => !timer.ran).sort((left, right) => left.delay - right.delay).forEach(runTimer);
    assert.equal(context.page.data.launchProgress, 12);
    assert.equal(context.page.data.launchSplashVisible, false);
  } finally {
    activityService.list = originalList;
    unloadDiscoverPage(context);
  }
});

test('页面卸载会清理启动计时器并恢复 TabBar，当前会话不重复播放', async () => {
  const originalList = activityService.list;
  let resolveList;
  activityService.list = () => new Promise((resolve) => { resolveList = resolve; });
  const context = loadDiscoverPage();
  try {
    const loading = context.page.onLoad();
    context.page.onUnload();
    assert.equal(context.timers.slice(0, 11).every((timer) => timer.cleared), true);
    assert.equal(context.tabBar.shown, 1);
    resolveList({ items: [], nextCursor: null });
    await loading;
    assert.equal(context.page.data.launchProgress, 0);
  } finally {
    activityService.list = originalList;
    unloadDiscoverPage(context);
  }
});

test('任一启动图片加载失败会立即退出蒙层、清理计时器并恢复 TabBar', async () => {
  const originalList = activityService.list;
  let resolveList;
  activityService.list = () => new Promise((resolve) => { resolveList = resolve; });
  const context = loadDiscoverPage();
  try {
    const loading = context.page.onLoad();
    context.page.handleLaunchAssetError();
    assert.equal(context.page.data.launchSplashVisible, false);
    assert.equal(context.timers.every((timer) => timer.cleared), true);
    assert.equal(context.tabBar.shown, 1);
    resolveList({ items: [], nextCursor: null });
    await loading;
    assert.equal(context.page.data.launchSplashVisible, false);
  } finally {
    activityService.list = originalList;
    unloadDiscoverPage(context);
  }
});

test('启动组件使用透明三维凹槽和立方体落块，封面与轨道保持静止', () => {
  const template = fs.readFileSync(path.join(root, 'miniprogram/components/launch-splash/index.wxml'), 'utf8');
  const pageTemplate = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.wxml'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'miniprogram/components/launch-splash/index.wxss'), 'utf8');
  const component = require('../miniprogram/components/launch-splash/index');
  const coverRule = style.match(/\.launch-cover\s*\{([^}]*)\}/);
  assert.match(template, /\.\.\/\.\.\/assets\/images\/launch-cover\.jpg/);
  assert.match(template, /mode="aspectFill"/);
  assert.match(template, /aria-role="progressbar"/);
  assert.match(template, /aria-label="拼吧正在加载，请稍候"/);
  assert.match(template, /aria-hidden="true"/);
  assert.match(template, /正在拼合活动…/);
  assert.match(template, /\.\.\/\.\.\/assets\/images\/launch-groove\.png/);
  assert.match(template, /\.\.\/\.\.\/assets\/images\/launch-cube\.png/);
  assert.equal((template.match(/binderror="handleAssetError"/g) || []).length, 3);
  assert.match(pageTemplate, /bindasseterror="handleLaunchAssetError"/);
  assert.match(template, /launch-cube-slot/);
  assert.equal(component.data.blocks.length, 12);
  assert.ok(coverRule);
  assert.doesNotMatch(coverRule[1], /animation|transition|transform/);
  assert.match(style, /\.launch-cube--active[\s\S]*animation:/);
  assert.match(style, /@keyframes launch-cube-drop/);
  assert.match(style, /bottom:\s*calc\(52rpx \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(style, /max-width:\s*86vw/);
  const grooveRule = style.match(/\.launch-groove\s*\{([^}]*)\}/);
  assert.ok(grooveRule);
  assert.doesNotMatch(grooveRule[1], /animation|transition|transform/);
});

test('启动页使用 iPhone 兼容 JPEG/PNG 且本地资源总量不超过 220KB', () => {
  const names = ['launch-cover.jpg', 'launch-groove.png', 'launch-cube.png'];
  const assets = names.map((name) => path.join(root, 'miniprogram/assets/images', name));
  let totalBytes = 0;
  assets.forEach((asset, index) => {
    const bytes = fs.readFileSync(asset);
    totalBytes += bytes.length;
    if (index === 0) assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xd8]);
    else assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
  assert.ok(totalBytes <= 220 * 1024, `启动素材总量为 ${totalBytes} bytes`);
  ['launch-cover.webp', 'launch-groove.webp', 'launch-cube.webp'].forEach((name) => {
    assert.equal(fs.existsSync(path.join(root, 'miniprogram/assets/images', name)), false);
  });
});

test('启动组件对重复图片错误只向页面上报一次', () => {
  const component = require('../miniprogram/components/launch-splash/index');
  let emitted = 0;
  const instance = {
    triggerEvent(name) {
      assert.equal(name, 'asseterror');
      emitted += 1;
    }
  };
  component.methods.handleAssetError.call(instance, { detail: { errMsg: 'image load failed' } });
  component.methods.handleAssetError.call(instance, { detail: { errMsg: 'image load failed again' } });
  assert.equal(emitted, 1);
});
