'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const userService = require('../miniprogram/services/user');

function loadUserPage() {
  let definition;
  global.Page = (value) => { definition = value; };
  global.wx = {
    getStorageSync() { return ''; },
    showToast() {}
  };
  const pagePath = require.resolve('../miniprogram/pages/user/index');
  delete require.cache[pagePath];
  require(pagePath);
  const calls = [];
  const page = {
    ...definition,
    data: { ...definition.data },
    setData(value) {
      calls.push(value);
      Object.assign(this.data, value);
    }
  };
  return { page, pagePath, calls };
}

function unload(pagePath) {
  delete require.cache[pagePath];
  delete global.Page;
  delete global.wx;
}

test('我的页面返回时保留现有图片节点且相同数据不重复 setData', async () => {
  const original = {
    login: userService.login,
    mine: userService.mine,
    notifications: userService.notifications
  };
  const user = {
    id: 'u1',
    profile: { nickname: '小拼', gender: 'MALE', interests: ['结伴同行'] }
  };
  userService.login = async () => user;
  userService.mine = async () => ({ owned: [], joined: [] });
  userService.notifications = async () => ({ items: [] });
  const harness = loadUserPage();
  try {
    await harness.page.loadDashboard();
    harness.calls.length = 0;
    await harness.page.loadDashboard();
    assert.equal(harness.calls.some((change) => change.loading === true), false);
    assert.equal(harness.calls.some((change) => Object.prototype.hasOwnProperty.call(change, 'profileAvatarPath')), false);
    assert.equal(harness.calls.some((change) => Object.prototype.hasOwnProperty.call(change, 'profileCoverPath')), false);
    assert.equal(harness.calls.some((change) => Object.prototype.hasOwnProperty.call(change, 'currentItems')), false);
  } finally {
    Object.assign(userService, original);
    unload(harness.pagePath);
  }
});
