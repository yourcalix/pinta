'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('未读快照跨Tab共享、拒绝乱序与异常数据、切换账号不串徽标', async () => {
  let scope = 'first';
  const app = { globalData: { user: { status: 'ACTIVE', profileComplete: true } } };
  let unread = async () => ({ totalUnread: 7 });
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/utils/tab-bar.js'), 'utf8'), {
    module, getApp: () => app,
    require: (name) => name.endsWith('/api') ? { getActorScope: () => scope } : { unread: () => unread() }
  });
  const { refreshUnread, selectTab } = module.exports;
  const bar = { setData() {}, setUnread(value) { this.value = value; } };
  const page = { getTabBar: () => bar };
  await refreshUnread();
  unread = async () => { throw new Error('offline'); };
  selectTab(page, 0);
  assert.equal(bar.value, 7);
  await refreshUnread(page);
  assert.equal(bar.value, 7);
  let release;
  unread = () => new Promise((resolve) => { release = resolve; });
  const slow = refreshUnread(page);
  unread = async () => ({ totalUnread: 2 });
  await refreshUnread(page);
  release({ totalUnread: 9 });
  await slow;
  assert.equal(bar.value, 2);
  unread = async () => ({});
  await refreshUnread(page);
  assert.equal(bar.value, 2);
  scope = 'second';
  selectTab(page, 1);
  assert.equal(bar.value, 0);
});
