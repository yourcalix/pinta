'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const activityService = require('../miniprogram/services/activity');

const root = path.join(__dirname, '..');

function readJpegDimensions(bytes) {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)];
    }
    offset += 2 + length;
  }
  throw new Error('JPEG dimensions not found');
}

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

test('高级启动动画采用 900 毫秒门限、380 毫秒冲刺、240 毫秒淡出和 4.5 秒硬退出', () => {
  const timing = require('../miniprogram/utils/launch-splash-timing');
  assert.equal(timing.MINIMUM_DISPLAY_MS, 900);
  assert.equal(timing.FINISH_MS, 380);
  assert.equal(timing.FADE_MS, 240);
  assert.equal(timing.LATE_READY_THRESHOLD_MS, 3800);
  assert.equal(timing.MAX_SPLASH_WAIT_MS, 4500);
  assert.deepEqual(Object.keys(timing).sort(), [
    'FADE_MS',
    'FINISH_MS',
    'LATE_READY_THRESHOLD_MS',
    'MAX_SPLASH_WAIT_MS',
    'MINIMUM_DISPLAY_MS'
  ]);
});

test('快速首屏请求等待全部素材与最短展示，完成冲刺后淡出并恢复 TabBar', async () => {
  const originalList = activityService.list;
  activityService.list = async () => ({ items: [], nextCursor: null });
  const context = loadDiscoverPage();
  try {
    const loading = context.page.onLoad();
    await loading;
    assert.equal(context.page.data.launchSplashVisible, true);
    assert.equal(context.page.data.launchSplashFinishing, false);
    assert.equal(context.page.data.launchSplashExiting, false);
    assert.equal(context.appGlobalData.launchSplashShown, true);
    assert.equal(context.tabBar.hidden, true);
    assert.deepEqual(context.tabBar.transitions, [true]);
    assert.deepEqual(context.nativeTabBar, { hidden: 0, shown: 0 });

    runTimer(context.timers.find((timer) => timer.delay === 900));
    assert.equal(context.page.data.launchSplashFinishing, false);
    assert.equal(context.page.data.launchSplashExiting, false);

    context.page.handleLaunchAssetsReady();
    assert.equal(context.page.data.launchSplashFinishing, true);
    assert.equal(context.page.data.launchSplashExiting, false);
    runTimer(context.timers.find((timer) => timer.delay === 380));
    assert.equal(context.page.data.launchSplashExiting, true);
    runTimer(context.timers.find((timer) => timer.delay === 240));
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

test('素材已就绪但数据未完成时保持缓行，数据就绪后才开始冲刺', async () => {
  const originalList = activityService.list;
  let resolveList;
  activityService.list = () => new Promise((resolve) => { resolveList = resolve; });
  const context = loadDiscoverPage();
  try {
    const loading = context.page.onLoad();
    context.page.handleLaunchAssetsReady();
    runTimer(context.timers.find((timer) => timer.delay === 900));
    assert.equal(context.page.data.launchSplashVisible, true);
    assert.equal(context.page.data.launchSplashFinishing, false);
    assert.equal(context.page.data.launchSplashExiting, false);

    resolveList({ items: [], nextCursor: null });
    await loading;
    assert.equal(context.page.data.launchSplashFinishing, true);
    runTimer(context.timers.find((timer) => timer.delay === 380));
    assert.equal(context.page.data.launchSplashExiting, true);
    runTimer(context.timers.find((timer) => timer.delay === 240));
    assert.equal(context.page.data.launchSplashVisible, false);
  } finally {
    activityService.list = originalList;
    unloadDiscoverPage(context);
  }
});

test('数据在 3.8 秒后才就绪时跳过冲刺直接淡出', async () => {
  const originalList = activityService.list;
  let resolveList;
  activityService.list = () => new Promise((resolve) => { resolveList = resolve; });
  const context = loadDiscoverPage();
  try {
    const loading = context.page.onLoad();
    context.page.handleLaunchAssetsReady();
    runTimer(context.timers.find((timer) => timer.delay === 900));
    context.page._launchSplashStartedAt = Date.now() - 3900;

    resolveList({ items: [], nextCursor: null });
    await loading;
    assert.equal(context.page.data.launchSplashFinishing, false);
    assert.equal(context.page.data.launchSplashExiting, true);
    assert.equal(context.timers.filter((timer) => timer.delay === 380).length, 0);

    runTimer(context.timers.find((timer) => timer.delay === 240));
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
    context.page.handleLaunchAssetsReady();
    runTimer(context.timers.find((timer) => timer.delay === 900));
    assert.equal(context.page.data.launchSplashExiting, false);
    runTimer(context.timers.find((timer) => timer.delay === 4500));
    assert.equal(context.page.data.launchSplashVisible, false);
    assert.equal(context.page.data.launchSplashFinishing, false);
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

test('任一启动动画素材失败都会立即退出蒙层、清理计时器并恢复 TabBar', async () => {
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

test('启动组件以澳门插画全屏铺底，并在下方叠加猫狗与双层纸纹进度条', () => {
  const template = fs.readFileSync(path.join(root, 'miniprogram/components/launch-splash/index.wxml'), 'utf8');
  const pageTemplate = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.wxml'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'miniprogram/components/launch-splash/index.wxss'), 'utf8');
  ['macau-companion-launch.jpg', 'loading-dog.png', 'loading-cat.png', 'loading-deco.png', 'loading-track.png', 'loading-fill.png']
    .forEach((asset) => assert.match(template, new RegExp(`launch/${asset.replace('.', '\\.')}`)));
  assert.equal((template.match(/bindload="handleAssetLoad"/g) || []).length, 6);
  assert.equal((template.match(/binderror="handleAssetError"/g) || []).length, 6);
  assert.match(template, /aria-role="alert"/);
  assert.match(template, /aria-label="拼吧正在加载，请稍候"/);
  assert.match(template, /class="launch-background"[^>]*mode="aspectFill"/);
  assert.match(template, /class="launch-bottom-veil"/);
  assert.match(template, /progress-mask/);
  assert.match(template, /runner-position/);
  assert.doesNotMatch(template, /正在为您拼吧|一起组队/);
  assert.match(pageTemplate, /finishing="\{\{launchSplashFinishing\}\}"/);
  assert.match(pageTemplate, /bindassetsready="handleLaunchAssetsReady"/);
  assert.match(pageTemplate, /bindasseterror="handleLaunchAssetError"/);
  assert.match(style, /background:\s*#f7ba3e/);
  assert.match(style, /\.launch-background\s*\{[^}]*position:\s*absolute[^}]*width:\s*100%[^}]*height:\s*100%/s);
  assert.match(style, /\.loading-shell\s*\{[^}]*position:\s*absolute[^}]*bottom:\s*calc\(40rpx \+ env\(safe-area-inset-bottom\)\)[^}]*width:\s*690rpx[^}]*height:\s*340rpx[^}]*overflow:\s*hidden/s);
  assert.match(style, /\.launch-splash--exiting\s*\{[^}]*opacity:\s*0[^}]*transition:\s*opacity 240ms ease-out/s);
  assert.match(style, /@keyframes dogRun/);
  assert.match(style, /@keyframes catRun/);
  assert.match(style, /@keyframes finishDash/);
  assert.doesNotMatch(style, /launch-piece|launch-puzzle|launch-title|launch-subtitle/);
});

test('启动背景与五张透明动画素材严格受主包预算约束', () => {
  const assetDirectory = path.join(root, 'miniprogram/assets/images/launch');
  const expected = new Map([
    ['loading-cat.png', [280, 280]],
    ['loading-dog.png', [280, 280]],
    ['loading-deco.png', [520, 260]],
    ['loading-track.png', [520, 71]],
    ['loading-fill.png', [520, 71]]
  ]);
  let totalBytes = 0;

  expected.forEach(([width, height], filename) => {
    const bytes = fs.readFileSync(path.join(assetDirectory, filename));
    totalBytes += bytes.length;
    assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(bytes.readUInt32BE(16), width, filename);
    assert.equal(bytes.readUInt32BE(20), height, filename);
    assert.equal(bytes[25], 3, `${filename} 必须为透明调色板 PNG`);
    assert.ok(bytes.includes(Buffer.from('tRNS')), `${filename} 必须保留 Alpha`);
  });

  assert.ok(totalBytes <= 80 * 1024, `启动动画素材合计 ${totalBytes} bytes`);

  const background = fs.readFileSync(path.join(assetDirectory, 'macau-companion-launch.jpg'));
  assert.deepEqual([...background.subarray(0, 2)], [0xff, 0xd8]);
  assert.deepEqual(readJpegDimensions(background), [540, 960]);
  assert.ok(background.includes(Buffer.from('JFIF')), '背景图必须为标准 Baseline JPEG');
  assert.ok(background.length <= 55 * 1024, `启动背景 ${background.length} bytes`);
  assert.ok(totalBytes + background.length <= 130 * 1024, `六张启动素材合计 ${totalBytes + background.length} bytes`);
});

test('启动组件等待背景与五张唯一动画素材全部就绪后才启动缓行', () => {
  const component = require('../miniprogram/components/launch-splash/index');
  let readyEvents = 0;
  let creepStarts = 0;
  const instance = {
    data: JSON.parse(JSON.stringify(component.data)),
    _loadedAssets: new Set(),
    setData(value) { Object.assign(this.data, value); },
    getRunnerLeft: component.methods.getRunnerLeft,
    startAutoCreep() { creepStarts += 1; },
    triggerEvent(name) {
      assert.equal(name, 'assetsready');
      readyEvents += 1;
    }
  };
  const load = (asset) => component.methods.handleAssetLoad.call(instance, {
    currentTarget: { dataset: { asset } }
  });

  ['background', 'dog', 'cat', 'deco', 'track'].forEach(load);
  load('dog');
  assert.equal(instance.data.assetsReady, false);
  assert.equal(readyEvents, 0);
  load('fill');
  assert.equal(instance.data.assetsReady, true);
  assert.equal(instance.data.progress, 12);
  assert.equal(readyEvents, 1);
  assert.equal(creepStarts, 1);
  load('fill');
  assert.equal(readyEvents, 1);
  assert.equal(creepStarts, 1);
});

test('猫狗组合的缓行与完成位移始终留在轨道安全边界内', () => {
  const component = require('../miniprogram/components/launch-splash/index');
  const getRunnerLeft = component.methods.getRunnerLeft;
  assert.equal(getRunnerLeft(0), 20);
  assert.equal(getRunnerLeft(86), 200);
  assert.equal(getRunnerLeft(100), 230);
  assert.equal(getRunnerLeft(-10), 20);
  assert.equal(getRunnerLeft(130), 230);
});

test('启动组件卸载后清理缓行计时器并阻止继续更新', () => {
  const component = require('../miniprogram/components/launch-splash/index');
  const instance = {
    _destroyed: false,
    _loadedAssets: new Set(['dog']),
    _creepTimer: setTimeout(() => {}, 10000),
    clearCreepTimer: component.methods.clearCreepTimer
  };
  component.lifetimes.detached.call(instance);
  assert.equal(instance._destroyed, true);
  assert.equal(instance._loadedAssets, null);
  assert.equal(instance._creepTimer, null);
});

test('启动组件对重复图片错误只向页面上报一次', () => {
  const component = require('../miniprogram/components/launch-splash/index');
  let emitted = 0;
  const instance = {
    clearCreepTimer() {},
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
  const splashScript = fs.readFileSync(path.join(root, 'miniprogram/components/launch-splash/index.js'), 'utf8');
  const tabScript = fs.readFileSync(path.join(root, 'miniprogram/custom-tab-bar/index.js'), 'utf8');
  const tabTemplate = fs.readFileSync(path.join(root, 'miniprogram/custom-tab-bar/index.wxml'), 'utf8');
  const tabStyle = fs.readFileSync(path.join(root, 'miniprogram/custom-tab-bar/index.wxss'), 'utf8');

  assert.doesNotMatch(discoverScript, /wx\.(?:hide|show)TabBar/);
  assert.doesNotMatch(splashScript, /runDemoLoading|console\.log|wx\.(?:switchTab|redirectTo)/);
  assert.match(discoverScript, /getTabBar\(\)/);
  assert.match(discoverScript, /tabBar\.setHidden\(hidden\)/);
  assert.match(tabScript, /hidden:\s*false/);
  assert.match(tabScript, /setHidden\(hidden\)/);
  assert.match(tabTemplate, /tab-shell--hidden/);
  assert.match(tabStyle, /\.tab-shell--hidden\s*\{[\s\S]*?display:\s*none\s*!important/);
});
