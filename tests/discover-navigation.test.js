'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { calculateContentTopInset } = require('../miniprogram/utils/navigation-layout');

const root = path.join(__dirname, '..');

test('四个 Tab 页面统一使用 custom navigation，发现、社区与发布页使用深色沉浸状态栏', () => {
  const discover = require('../miniprogram/pages/discover/index.json');
  const community = require('../miniprogram/pages/community/index.json');
  const publish = require('../miniprogram/pages/publish/index.json');
  const user = require('../miniprogram/pages/user/index.json');
  assert.equal(user.navigationStyle, 'custom');
  assert.equal(user.navigationBarTitleText, undefined);
  assert.equal(user.navigationBarTextStyle, 'black');
  assert.equal(user.backgroundColorTop, '#F5F7F6');
  assert.equal(discover.navigationStyle, 'custom');
  assert.equal(discover.navigationBarTitleText, undefined);
  assert.equal(discover.navigationBarTextStyle, 'white');
  assert.equal(discover.backgroundColorTop, '#075AA7');
  assert.equal(discover.backgroundTextStyle, 'light');
  assert.equal(community.navigationStyle, 'custom');
  assert.equal(community.navigationBarTitleText, undefined);
  assert.equal(community.navigationBarTextStyle, 'white');
  assert.equal(community.backgroundColorTop, '#075AA7');
  assert.equal(community.backgroundTextStyle, 'light');
  assert.equal(publish.navigationStyle, 'custom');
  assert.equal(publish.navigationBarTitleText, undefined);
  assert.equal(publish.navigationBarTextStyle, 'white');
  assert.equal(publish.backgroundColorTop, '#075AA7');
});

test('顶部安全区使用胶囊底边、对称间距和 8px 呼吸区', () => {
  const platform = {
    getWindowInfo: () => ({ statusBarHeight: 47 }),
    getMenuButtonBoundingClientRect: () => ({ top: 51, bottom: 83, height: 32 })
  };
  assert.equal(calculateContentTopInset(platform), 95);
});

test('胶囊零值、缺失或 API 抛错时降级为状态栏加 52px', () => {
  assert.equal(calculateContentTopInset({
    getWindowInfo: () => ({ statusBarHeight: 24 }),
    getMenuButtonBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0 })
  }), 76);
  assert.equal(calculateContentTopInset({
    getWindowInfo() { throw new Error('not ready'); },
    getMenuButtonBoundingClientRect() { throw new Error('not ready'); }
  }), 72);
  assert.equal(calculateContentTopInset(null), 72);
});

test('发现页正文动态避让顶部，但固定启动层继续覆盖完整视口', () => {
  const template = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.wxml'), 'utf8');
  const pageStyle = fs.readFileSync(path.join(root, 'miniprogram/pages/discover/index.wxss'), 'utf8');
  const splashStyle = fs.readFileSync(path.join(root, 'miniprogram/components/launch-splash/index.wxss'), 'utf8');
  const discoverRule = pageStyle.match(/\.discover-page\s*\{([^}]*)\}/);
  const splashRule = splashStyle.match(/\.launch-splash\s*\{([^}]*)\}/);
  assert.match(template, /style="padding-top: \{\{contentTopInset\}\}px;"/);
  assert.ok(discoverRule);
  assert.doesNotMatch(discoverRule[1], /padding-top:\s*30rpx/);
  assert.match(discoverRule[1], /box-sizing:\s*border-box/);
  assert.ok(splashRule);
  assert.match(splashRule[1], /position:\s*fixed/);
  assert.match(splashRule[1], /inset:\s*0/);
});

test('发布与我的页面正文动态避让顶部并使用完整视口盒模型', () => {
  for (const pageName of ['publish', 'user']) {
    const pageDirectory = path.join(root, `miniprogram/pages/${pageName}`);
    const template = fs.readFileSync(path.join(pageDirectory, 'index.wxml'), 'utf8');
    const pageStyle = fs.readFileSync(path.join(pageDirectory, 'index.wxss'), 'utf8');
    const rootRule = pageStyle.match(new RegExp(`\\.${pageName}-page\\s*\\{([^}]*)\\}`));

    assert.match(template, /style="padding-top: \{\{contentTopInset\}\}px;"/);
    assert.ok(rootRule);
    assert.match(rootRule[1], /box-sizing:\s*border-box/);
    assert.match(rootRule[1], /min-height:\s*100vh/);
    assert.doesNotMatch(rootRule[1], /padding-top:\s*(?:42|28)rpx/);
  }
});
