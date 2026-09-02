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

test('启动进度采用四块拼图顺序、1.2 秒门限和 4.5 秒硬退出', () => {
  const progress = require('../miniprogram/utils/launch-progress');
  assert.equal(progress.TOTAL_BLOCKS, 4);
  assert.equal(progress.PRELOAD_BLOCKS, 3);
  assert.equal(progress.STEP_INTERVAL_MS, 350);
  assert.equal(progress.FINISH_GATE_MS, 1200);
  assert.equal(progress.FINISH_INTERVAL_MS, 0);
  assert.equal(progress.DROP_DURATION_MS, 350);
  assert.equal(progress.HOLD_MS, 300);
  assert.equal(progress.FADE_MS, 300);
  assert.equal(progress.MAX_SPLASH_WAIT_MS, 4500);
  assert.deepEqual(progress.createProgressBlocks(), [
    { id: 1, key: 'top-left', color: '#16A36A', zIndex: 4 },
    { id: 2, key: 'bottom-left', color: '#2EBD85', zIndex: 3 },
    { id: 3, key: 'bottom-right', color: '#5CD19E', zIndex: 2 },
    { id: 4, key: 'top-right', color: '#8EE3B8', zIndex: 1 }
  ]);
});

test('快速首屏请求也等待前三块落下，再补齐第四块并恢复 TabBar', async () => {
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

    context.timers.filter((timer) => timer.delay < 1200).forEach(runTimer);
    assert.equal(context.page.data.launchProgress, 3);
    assert.equal(context.page.data.launchSplashVisible, true);
    assert.equal(context.timers.length, 5);

    runTimer(context.timers.find((timer) => timer.delay === 1200));
    const finishTimers = context.timers.filter((timer) => !timer.ran).sort((left, right) => left.delay - right.delay);
    assert.deepEqual(finishTimers.map((timer) => timer.delay), [0, 650, 950, 4500]);
    finishTimers.forEach(runTimer);
    assert.equal(context.page.data.launchProgress, 4);
    assert.equal(context.page.data.launchSplashVisible, false);
    assert.equal(context.tabBar.shown, 1);
    assert.equal(context.page.startLaunchSplash(), false);
  } finally {
    activityService.list = originalList;
    unloadDiscoverPage(context);
  }
});

test('数据未完成时停在第三块，结束后才允许第四块落下', async () => {
  const originalList = activityService.list;
  let resolveList;
  activityService.list = () => new Promise((resolve) => { resolveList = resolve; });
  const context = loadDiscoverPage();
  try {
    const loading = context.page.onLoad();
    context.timers.filter((timer) => timer.delay <= 1200).forEach(runTimer);
    assert.equal(context.page.data.launchProgress, 3);
    assert.equal(context.timers.length, 5);

    resolveList({ items: [], nextCursor: null });
    await loading;
    assert.equal(context.timers.length, 8);
    context.timers.filter((timer) => !timer.ran).sort((left, right) => left.delay - right.delay).forEach(runTimer);
    assert.equal(context.page.data.launchProgress, 4);
    assert.equal(context.page.data.launchSplashVisible, false);
  } finally {
    activityService.list = originalList;
    unloadDiscoverPage(context);
  }
});

test('首屏请求超过 4.5 秒时安全退出，但不伪造第四块完成', async () => {
  const originalList = activityService.list;
  let resolveList;
  activityService.list = () => new Promise((resolve) => { resolveList = resolve; });
  const context = loadDiscoverPage();
  try {
    const loading = context.page.onLoad();
    context.timers.filter((timer) => timer.delay <= 1200).forEach(runTimer);
    assert.equal(context.page.data.launchProgress, 3);
    runTimer(context.timers.find((timer) => timer.delay === 4500));
    assert.equal(context.page.data.launchSplashVisible, false);
    assert.equal(context.page.data.launchProgress, 3);
    assert.equal(context.tabBar.shown, 1);

    resolveList({ items: [], nextCursor: null });
    await loading;
    assert.equal(context.page.data.launchProgress, 3);
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
    assert.equal(context.timers.slice(0, 5).every((timer) => timer.cleared), true);
    assert.equal(context.tabBar.shown, 1);
    resolveList({ items: [], nextCursor: null });
    await loading;
    assert.equal(context.page.data.launchProgress, 0);
  } finally {
    activityService.list = originalList;
    unloadDiscoverPage(context);
  }
});

test('任一拼图图片加载失败会立即退出蒙层、清理计时器并恢复 TabBar', async () => {
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

test('启动组件使用四块独立 PNG、外层落下与内层静态定位', () => {
  const template = fs.readFileSync(path.join(root, 'miniprogram/components/launch-splash/index.wxml'), 'utf8');
  const pageTemplate = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.wxml'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'miniprogram/components/launch-splash/index.wxss'), 'utf8');
  const expectedAssets = ['piece-top-left', 'piece-bottom-left', 'piece-bottom-right', 'piece-top-right'];

  expectedAssets.forEach((name) => assert.match(template, new RegExp(`launch-puzzle/${name}\\.png`)));
  assert.equal((template.match(/binderror="handleAssetError"/g) || []).length, 4);
  assert.match(template, /aria-role="alert"/);
  assert.match(template, /aria-label="拼吧正在加载，请稍候"/);
  assert.match(template, /正在为您拼吧/);
  assert.match(template, /一起组队，马上出发/);
  assert.match(template, /launch-piece-drop--top-left/);
  assert.match(template, /launch-piece-drop--top-right/);
  assert.match(template, /launch-piece-drop--bottom-left/);
  assert.match(template, /launch-piece-drop--bottom-right/);
  assert.match(template, /launch-piece-static/);
  assert.equal((template.match(/launch-progress-segment--[1-4]/g) || []).length, 4);
  assert.match(pageTemplate, /bindasseterror="handleLaunchAssetError"/);
  assert.match(style, /\.launch-piece-drop--active[\s\S]*launch-piece-drop 350ms/);
  assert.match(style, /@keyframes launch-piece-drop/);
  assert.match(style, /@keyframes launch-puzzle-lock/);
  assert.match(style, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(style, /width:\s*78vw/);
  assert.match(style, /max-width:\s*580rpx/);
  assert.match(style, /font-size:\s*42rpx/);
  assert.match(style, /\.launch-content\s*\{[\s\S]*?top:\s*24vh/);
  assert.match(style, /@media \(max-height:\s*700px\)[\s\S]*?\.launch-content\s*\{[\s\S]*?top:\s*17vh/);
  assert.match(style, /\.launch-piece-drop\s*\{[\s\S]*inset:\s*0/);
});

test('四张启动拼图为透明 PNG，主包资源总量不超过 220KB', () => {
  const names = ['piece-top-left.png', 'piece-bottom-left.png', 'piece-bottom-right.png', 'piece-top-right.png'];
  let totalBytes = 0;
  names.forEach((name) => {
    const bytes = fs.readFileSync(path.join(root, 'miniprogram/assets/images/launch-puzzle', name));
    totalBytes += bytes.length;
    assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(bytes.readUInt32BE(16), 800, `${name} 画布宽度必须统一为 800px`);
    assert.equal(bytes.readUInt32BE(20), 800, `${name} 画布高度必须统一为 800px`);
    const colorType = bytes[25];
    const hasPaletteTransparency = bytes.includes(Buffer.from('tRNS'));
    assert.ok(colorType === 4 || colorType === 6 || hasPaletteTransparency, `${name} 缺少透明通道`);
  });
  assert.ok(totalBytes <= 220 * 1024, `启动素材总量为 ${totalBytes} bytes`);
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
