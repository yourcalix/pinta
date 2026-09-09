'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function jpegFrameMarker(buffer) {
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) return null;
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return marker;
    offset += 2 + length;
  }
  return null;
}

function jpegDimensions(buffer) {
  let offset = 2;
  while (offset + 9 <= buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return {
        width: buffer.readUInt16BE(offset + 7),
        height: buffer.readUInt16BE(offset + 5)
      };
    }
    offset += 2 + length;
  }
  return null;
}

function loadHomePage() {
  let definition;
  const timers = [];
  const navigations = [];
  const toasts = [];
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;

  global.Page = (value) => { definition = value; };
  global.getApp = () => ({ globalData: { user: null, launchSplashShown: true } });
  global.wx = {
    getStorageSync: () => [],
    navigateTo(options) { navigations.push(options); },
    pageScrollTo() {},
    showToast(options) { toasts.push(options); },
    stopPullDownRefresh() {},
    switchTab() {}
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
    navigations,
    toasts,
    page: {
      ...definition,
      data: { ...definition.data },
      setData(value) { Object.assign(this.data, value); }
    },
    restore() {
      delete require.cache[pagePath];
      if (originalPage === undefined) delete global.Page;
      else global.Page = originalPage;
      if (originalWx === undefined) delete global.wx;
      else global.wx = originalWx;
      if (originalGetApp === undefined) delete global.getApp;
      else global.getApp = originalGetApp;
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
    }
  };
}

test('琐碎回忆入口进入活动分包预告页并阻止连点重复入栈', () => {
  const context = loadHomePage();
  try {
    const event = { currentTarget: { dataset: { action: 'memories' } } };
    assert.equal(context.page.handleHomeShortcut(event), true);
    assert.equal(context.page.handleHomeShortcut(event), false);
    assert.equal(context.navigations.length, 1);
    assert.equal(context.navigations[0].url, '/subpackages/activity/memories/index');
    assert.equal(context.timers.at(-1).delay, 500);

    context.timers.at(-1).handler();
    assert.equal(context.page.handleHomeShortcut(event), true);

    context.navigations.at(-1).fail();
    assert.equal(context.page.handleHomeShortcut(event), true);
    assert.equal(context.toasts.at(-1).title, '页面打开失败，请稍后重试');
  } finally {
    context.restore();
  }
});

test('成团记忆独立页注册在活动分包且不接入活动事实接口', () => {
  const app = JSON.parse(read('app.json'));
  const activityPackage = app.subPackages.find((item) => item.root === 'subpackages/activity');
  const script = read('subpackages/activity/memories/index.js');
  const config = JSON.parse(read('subpackages/activity/memories/index.json'));

  assert.ok(activityPackage.pages.includes('memories/index'));
  assert.equal(config.navigationBarTitleText, '成团记忆');
  assert.equal(config.navigationBarBackgroundColor.toLowerCase(), '#f9f7f2');
  assert.doesNotMatch(script, /activityService|activity\.memories|wx\.cloud|request|fetch/);
  assert.doesNotMatch(script, /onShareAppMessage/);
});

test('成团记忆预告页恢复归档画报、明确筹备状态且空槽不可交互', () => {
  const template = read('subpackages/activity/memories/index.wxml');
  const style = read('subpackages/activity/memories/index.wxss');

  assert.match(template, /拼友成团故事分享与精选晒图功能正在筹备中，近期开放/);
  assert.match(template, /OUR STORIES/);
  assert.match(template, /分享你的/);
  assert.match(template, /<text class="memory-title-accent">成团<\/text><text>记忆<\/text>/);
  assert.match(template, /成团故事[\s\S]*分享功能即将开放/);
  assert.match(template, /虚位以待[\s\S]*敬请期待/);
  assert.match(template, /等你来分享[\s\S]*记录精彩瞬间/);
  assert.match(template, /aria-label="成团记忆专题画报，记录每一次顺利成团的珍贵瞬间，分享功能即将开放"/);
  assert.match(template, /src="\.\/assets\/formed-memory-editorial-bg\.jpg"[^>]*mode="aspectFill"[^>]*aria-hidden="true"/);
  assert.doesNotMatch(template, /bindtap|catchtap|role="button"|<button/);

  assert.match(style, /page\s*\{[^}]*background:\s*#f9f7f2;/s);
  assert.match(style, /\.memory-preview-page\s*\{[^}]*padding:\s*36rpx 28rpx calc\(48rpx \+ env\(safe-area-inset-bottom\)\) 28rpx;/s);
  assert.match(style, /\.memory-panel\s*\{[^}]*width:\s*694rpx;[^}]*height:\s*860rpx;[^}]*padding:\s*24rpx;[^}]*background:\s*linear-gradient\(180deg, #4fa4f8 0%, #207be5 100%\);/s);
  assert.match(style, /\.memory-grid\s*\{[^}]*grid-template-columns:\s*315rpx 315rpx;[^}]*grid-template-rows:\s*286rpx 286rpx;[^}]*gap:\s*16rpx;/s);
  assert.match(style, /\.memory-slot--lead\s*\{[^}]*grid-row:\s*1 \/ 3;[^}]*height:\s*588rpx;/s);
  assert.match(style, /\.memory-slot\s*\{[^}]*pointer-events:\s*none;[^}]*user-select:\s*none;/s);
  assert.match(style, /@media \(max-width:\s*340px\)[\s\S]*\.memory-panel\s*\{[^}]*width:\s*600rpx;[^}]*height:\s*744rpx;[^}]*padding:\s*18rpx;/s);
  assert.match(style, /@media \(max-width:\s*340px\)[\s\S]*\.memory-grid\s*\{[^}]*grid-template-columns:\s*272rpx 272rpx;[^}]*grid-template-rows:\s*248rpx 248rpx;[^}]*gap:\s*12rpx;/s);
  assert.match(style, /@media \(max-width:\s*340px\)[\s\S]*\.memory-slot--lead\s*\{[^}]*height:\s*508rpx;/s);
});

test('活动分包画报背景保持归档尺寸、Baseline 编码与轻量体积', () => {
  const buffer = fs.readFileSync(path.join(root, 'subpackages/activity/memories/assets/formed-memory-editorial-bg.jpg'));
  assert.ok(buffer.length < 50 * 1024, `背景图 ${buffer.length} bytes 应小于 50KB`);
  assert.equal(jpegFrameMarker(buffer), 0xc0);
  assert.deepEqual(jpegDimensions(buffer), { width: 694, height: 860 });
});
