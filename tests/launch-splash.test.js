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
  const nativeTabBar = { hidden: 0, shown: 0 };
  const tabBar = {
    hidden: false,
    transitions: [],
    setHidden(hidden) {
      this.hidden = Boolean(hidden);
      this.transitions.push(this.hidden);
    }
  };
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
    hideTabBar() { nativeTabBar.hidden += 1; },
    showTabBar() { nativeTabBar.shown += 1; }
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
    nativeTabBar,
    appGlobalData,
    originalSetTimeout,
    originalClearTimeout,
    originalGetApp,
    page: {
      ...definition,
      data: JSON.parse(JSON.stringify(definition.data)),
      setData(value) { Object.assign(this.data, value); },
      getTabBar() { return tabBar; }
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

test('启动插画采用 1.2 秒最短展示、300 毫秒淡出和 4.5 秒硬退出', () => {
  const timing = require('../miniprogram/utils/launch-splash-timing');
  assert.equal(timing.MINIMUM_DISPLAY_MS, 1200);
  assert.equal(timing.FADE_MS, 300);
  assert.equal(timing.MAX_SPLASH_WAIT_MS, 4500);
  assert.deepEqual(Object.keys(timing).sort(), ['FADE_MS', 'MAX_SPLASH_WAIT_MS', 'MINIMUM_DISPLAY_MS']);
});

test('快速首屏请求等待最短展示后淡出并恢复 TabBar', async () => {
  const originalList = activityService.list;
  activityService.list = async () => ({ items: [], nextCursor: null });
  const context = loadDiscoverPage();
  try {
    const loading = context.page.onLoad();
    await loading;
    assert.equal(context.page.data.launchSplashVisible, true);
    assert.equal(context.page.data.launchSplashExiting, false);
    assert.equal(context.appGlobalData.launchSplashShown, true);
    assert.equal(context.tabBar.hidden, true);
    assert.deepEqual(context.tabBar.transitions, [true]);
    assert.deepEqual(context.nativeTabBar, { hidden: 0, shown: 0 });

    runTimer(context.timers.find((timer) => timer.delay === 1200));
    assert.equal(context.page.data.launchSplashExiting, true);
    runTimer(context.timers.find((timer) => timer.delay === 300));
    assert.equal(context.page.data.launchSplashVisible, false);
    assert.equal(context.tabBar.hidden, false);
    assert.deepEqual(context.tabBar.transitions, [true, false]);
    assert.deepEqual(context.nativeTabBar, { hidden: 0, shown: 0 });
    assert.equal(context.page.startLaunchSplash(), false);
  } finally {
    activityService.list = originalList;
    unloadDiscoverPage(context);
  }
});

test('数据未完成时保持插画，完成后才开始淡出', async () => {
  const originalList = activityService.list;
  let resolveList;
  activityService.list = () => new Promise((resolve) => { resolveList = resolve; });
  const context = loadDiscoverPage();
  try {
    const loading = context.page.onLoad();
    runTimer(context.timers.find((timer) => timer.delay === 1200));
    assert.equal(context.page.data.launchSplashVisible, true);
    assert.equal(context.page.data.launchSplashExiting, false);

    resolveList({ items: [], nextCursor: null });
    await loading;
    assert.equal(context.page.data.launchSplashExiting, true);
    runTimer(context.timers.find((timer) => timer.delay === 300));
    assert.equal(context.page.data.launchSplashVisible, false);
  } finally {
    activityService.list = originalList;
    unloadDiscoverPage(context);
  }
});

test('首屏请求超过 4.5 秒时安全退出且不伪造完成动效', async () => {
  const originalList = activityService.list;
  let resolveList;
  activityService.list = () => new Promise((resolve) => { resolveList = resolve; });
  const context = loadDiscoverPage();
  try {
    const loading = context.page.onLoad();
    runTimer(context.timers.find((timer) => timer.delay === 1200));
    assert.equal(context.page.data.launchSplashExiting, false);
    runTimer(context.timers.find((timer) => timer.delay === 4500));
    assert.equal(context.page.data.launchSplashVisible, false);
    assert.equal(context.page.data.launchSplashExiting, false);
    assert.equal(context.tabBar.hidden, false);
    assert.deepEqual(context.nativeTabBar, { hidden: 0, shown: 0 });

    resolveList({ items: [], nextCursor: null });
    await loading;
    assert.equal(context.page._launchSplashActive, false);
    assert.equal(Object.prototype.hasOwnProperty.call(context.page.data, 'launchProgress'), false);
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
    assert.equal(context.timers.slice(0, 2).every((timer) => timer.cleared), true);
    assert.equal(context.tabBar.hidden, false);
    assert.deepEqual(context.nativeTabBar, { hidden: 0, shown: 0 });
    resolveList({ items: [], nextCursor: null });
    await loading;
    assert.equal(context.page._launchSplashActive, false);
    assert.equal(Object.prototype.hasOwnProperty.call(context.page.data, 'launchProgress'), false);
  } finally {
    activityService.list = originalList;
    unloadDiscoverPage(context);
  }
});

test('启动插画加载失败会立即退出蒙层、清理计时器并恢复 TabBar', async () => {
  const originalList = activityService.list;
  let resolveList;
  activityService.list = () => new Promise((resolve) => { resolveList = resolve; });
  const context = loadDiscoverPage();
  try {
    const loading = context.page.onLoad();
    context.page.handleLaunchAssetError();
    assert.equal(context.page.data.launchSplashVisible, false);
    assert.equal(context.timers.every((timer) => timer.cleared), true);
    assert.equal(context.tabBar.hidden, false);
    assert.deepEqual(context.nativeTabBar, { hidden: 0, shown: 0 });
    resolveList({ items: [], nextCursor: null });
    await loading;
    assert.equal(context.page.data.launchSplashVisible, false);
  } finally {
    activityService.list = originalList;
    unloadDiscoverPage(context);
  }
});

test('启动组件只使用全屏澳门插画并彻底移除旧拼图与视觉进度', () => {
  const template = fs.readFileSync(path.join(root, 'miniprogram/components/launch-splash/index.wxml'), 'utf8');
  const pageTemplate = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.wxml'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'miniprogram/components/launch-splash/index.wxss'), 'utf8');
  assert.match(template, /launch\/macau-companion-launch\.jpg/);
  assert.match(template, /mode="aspectFill"/);
  assert.equal((template.match(/binderror="handleAssetError"/g) || []).length, 1);
  assert.match(template, /aria-role="alert"/);
  assert.match(template, /aria-label="拼吧正在加载，请稍候"/);
  assert.doesNotMatch(template, /launch-piece|launch-puzzle|launch-progress|正在为您拼吧|一起组队/);
  assert.doesNotMatch(pageTemplate, /launchProgress|progress="/);
  assert.match(pageTemplate, /bindasseterror="handleLaunchAssetError"/);
  assert.match(style, /background-color:\s*#f7ba3e/);
  assert.match(style, /\.launch-splash__image\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/s);
  assert.match(style, /\.launch-splash--exiting\s*\{[^}]*opacity:\s*0[^}]*transition:\s*opacity 300ms ease-out/s);
  assert.doesNotMatch(style, /@keyframes|launch-piece|launch-puzzle|launch-progress|launch-title|launch-subtitle/);
});

test('澳门启动插画为 750×1334 Baseline JPEG 且满足主包预算', () => {
  const assetPath = path.join(root, 'miniprogram/assets/images/launch/macau-companion-launch.jpg');
  const bytes = fs.readFileSync(assetPath);
  const baselineMarkerIndex = bytes.indexOf(Buffer.from([0xff, 0xc0]));
  assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xd8]);
  assert.notEqual(baselineMarkerIndex, -1, '启动图必须包含 Baseline SOF0 标记');
  assert.equal(bytes.readUInt16BE(baselineMarkerIndex + 5), 1334);
  assert.equal(bytes.readUInt16BE(baselineMarkerIndex + 7), 750);
  assert.equal(bytes.includes(Buffer.from([0xff, 0xc2])), false, '启动图不得为 Progressive JPEG');
  assert.ok(bytes.length <= 140 * 1024, `启动插画为 ${bytes.length} bytes`);
  assert.equal(fs.existsSync(path.join(root, 'miniprogram/assets/images/launch-puzzle')), false);
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

test('启动流程只控制自定义 TabBar 且全工程不调用原生显隐 API', () => {
  const discoverScript = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.js'), 'utf8');
  const tabScript = fs.readFileSync(path.join(root, 'miniprogram/custom-tab-bar/index.js'), 'utf8');
  const tabTemplate = fs.readFileSync(path.join(root, 'miniprogram/custom-tab-bar/index.wxml'), 'utf8');
  const tabStyle = fs.readFileSync(path.join(root, 'miniprogram/custom-tab-bar/index.wxss'), 'utf8');

  assert.doesNotMatch(discoverScript, /wx\.(?:hide|show)TabBar/);
  assert.match(discoverScript, /getTabBar\(\)/);
  assert.match(discoverScript, /tabBar\.setHidden\(hidden\)/);
  assert.match(tabScript, /hidden:\s*false/);
  assert.match(tabScript, /setHidden\(hidden\)/);
  assert.match(tabTemplate, /tab-shell--hidden/);
  assert.match(tabStyle, /\.tab-shell--hidden\s*\{[\s\S]*?display:\s*none\s*!important/);
});
