'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { resolveBeijingGreeting } = require('../miniprogram/utils/home-greeting');
const userService = require('../miniprogram/services/user');

const atBeijingTime = (hour, minute = 0) => new Date(Date.UTC(2026, 8, 10, hour - 8, minute));

test('首页问候按北京时间覆盖凌晨、早上、上午、中午、下午和晚上', () => {
  const cases = [
    [0, '夜深了'], [4, '夜深了'],
    [5, '早上好'], [8, '早上好'],
    [9, '上午好'], [11, '上午好'],
    [12, '中午好'], [13, '中午好'],
    [14, '下午好'], [17, '下午好'],
    [18, '晚上好'], [23, '晚上好']
  ];
  cases.forEach(([hour, expected]) => assert.equal(resolveBeijingGreeting(atBeijingTime(hour)), expected));
});

test('首页展示动态问候并在页面载入和每次显示时刷新', () => {
  const script = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/discover/index.js'), 'utf8');
  const template = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/discover/index.wxml'), 'utf8');
  assert.match(template, /\{\{greetingSalutation\}\}，\{\{greetingNickname\}\}/);
  assert.match(script, /syncGreetingSalutation\(\)/);
  assert.ok((script.match(/this\.syncGreetingSalutation\(\)/g) || []).length >= 2);
});

test('首页只读加载当前账号昵称，失败或离屏响应不会覆盖现有称呼', async () => {
  const originalPage = global.Page;
  const originalGetApp = global.getApp;
  const originalGetProfile = userService.getProfile;
  let definition;
  global.Page = (value) => { definition = value; };
  global.getApp = () => ({ globalData: { user: null } });
  const pagePath = require.resolve('../miniprogram/pages/discover/index');
  delete require.cache[pagePath];
  require(pagePath);
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value) { Object.assign(this.data, value); }
  };

  try {
    userService.getProfile = async () => ({
      user: { profile: { nickname: '小拼友', avatarUrl: '' } }
    });
    assert.equal(await page.loadGreetingProfile(), true);
    assert.equal(page.data.greetingNickname, '小拼友');

    userService.getProfile = async () => { throw new Error('network unavailable'); };
    assert.equal(await page.loadGreetingProfile(), false);
    assert.equal(page.data.greetingNickname, '小拼友');

    let resolveProfile;
    userService.getProfile = () => new Promise((resolve) => { resolveProfile = resolve; });
    const pending = page.loadGreetingProfile();
    page.invalidateGreetingProfileLoad();
    resolveProfile({ user: { profile: { nickname: '迟到昵称' } } });
    assert.equal(await pending, false);
    assert.equal(page.data.greetingNickname, '小拼友');
  } finally {
    userService.getProfile = originalGetProfile;
    delete require.cache[pagePath];
    if (originalPage === undefined) delete global.Page;
    else global.Page = originalPage;
    if (originalGetApp === undefined) delete global.getApp;
    else global.getApp = originalGetApp;
  }
});

test('首页账号昵称读取不调用会创建账号的登录接口', () => {
  const script = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/discover/index.js'), 'utf8');
  assert.match(script, /userService\.getProfile\(\)/);
  assert.doesNotMatch(script, /userService\.login\(\)/);
});
