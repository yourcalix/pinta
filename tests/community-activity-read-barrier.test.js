'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SERVICE_PATH = path.join(__dirname, '../miniprogram/services/community.js');

function loadService(api, timers = {}) {
  const source = fs.readFileSync(SERVICE_PATH, 'utf8');
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require: (name) => {
      if (name === './api') return api;
      throw new Error(`Unexpected require: ${name}`);
    },
    setTimeout: timers.setTimeout || setTimeout,
    clearTimeout: timers.clearTimeout || clearTimeout,
    Promise,
    Set
  }, { filename: SERVICE_PATH });
  return module.exports;
}

async function flush(times = 8) {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

test('动态列表与未读汇总等待在途已读请求完成后再读取权威快照', async () => {
  const calls = [];
  let resolveRead;
  const service = loadService({
    invoke(action) {
      calls.push(action);
      if (action === 'community.activity.read') {
        return new Promise((resolve) => { resolveRead = resolve; });
      }
      if (action === 'community.activity.list') return Promise.resolve({ items: [{ id: 'activity-1', read: true }] });
      if (action === 'community.activity.unread') return Promise.resolve({ total: 0, tabs: { ALL: 0, REPLIES: 0, LIKES: 0 } });
      throw new Error(`Unexpected action: ${action}`);
    }
  });

  const readRequest = service.readActivity('activity-1', '2026-09-17T01:00:00.000Z', 'post-1');
  const listRequest = service.listActivities({ tab: 'ALL' });
  const unreadRequest = service.getActivityUnread();
  await flush();
  assert.deepEqual(calls, ['community.activity.read']);

  resolveRead({ activityId: 'activity-1', read: true, stale: false });
  const [readResult, listResult, unreadResult] = await Promise.all([readRequest, listRequest, unreadRequest]);
  assert.equal(readResult.read, true);
  assert.equal(listResult.items[0].read, true);
  assert.equal(unreadResult.total, 0);
  assert.deepEqual(calls.slice(1).sort(), ['community.activity.list', 'community.activity.unread']);
});

test('已读请求失败会释放屏障并让后续读取保留服务端未读事实', async () => {
  const calls = [];
  let rejectRead;
  const service = loadService({
    invoke(action) {
      calls.push(action);
      if (action === 'community.activity.read') {
        return new Promise((_resolve, reject) => { rejectRead = reject; });
      }
      if (action === 'community.activity.unread') return Promise.resolve({ total: 1, tabs: { ALL: 1, REPLIES: 1, LIKES: 0 } });
      throw new Error(`Unexpected action: ${action}`);
    }
  });

  const readRequest = service.readActivity('activity-1').catch((error) => error);
  const unreadRequest = service.getActivityUnread();
  await flush();
  assert.deepEqual(calls, ['community.activity.read']);
  rejectRead(new Error('offline'));
  assert.match((await readRequest).message, /offline/);
  assert.equal((await unreadRequest).total, 1);
  assert.deepEqual(calls, ['community.activity.read', 'community.activity.unread']);

  await service.getActivityUnread();
  assert.equal(calls.filter((action) => action === 'community.activity.unread').length, 2);
});

test('已读请求超过旧两秒阈值时屏障仍等待真实写入结算', async () => {
  const calls = [];
  const timers = [];
  let resolveRead;
  const service = loadService({
    invoke(action) {
      calls.push(action);
      if (action === 'community.activity.read') return new Promise((resolve) => { resolveRead = resolve; });
      if (action === 'community.activity.unread') return Promise.resolve({ total: 0, tabs: { ALL: 0, REPLIES: 0, LIKES: 0 } });
      throw new Error(`Unexpected action: ${action}`);
    }
  }, {
    setTimeout(callback, delay) {
      timers.push({ callback, delay, cleared: false });
      return timers.length;
    },
    clearTimeout(id) {
      if (timers[id - 1]) timers[id - 1].cleared = true;
    }
  });

  service.readActivity('activity-1');
  const unreadRequest = service.getActivityUnread();
  await flush();
  assert.deepEqual(calls, ['community.activity.read']);
  assert.equal(timers.length, 0);

  resolveRead({ activityId: 'activity-1', read: true, stale: false });
  await flush();
  assert.equal((await unreadRequest).total, 0);
  assert.deepEqual(calls, ['community.activity.read', 'community.activity.unread']);
});

test('读取只等待调用时的已读快照，不被随后产生的写入饿死', async () => {
  const calls = [];
  const readResolvers = [];
  const service = loadService({
    invoke(action) {
      calls.push(action);
      if (action === 'community.activity.read') {
        return new Promise((resolve) => { readResolvers.push(resolve); });
      }
      if (action === 'community.activity.unread') return Promise.resolve({ total: 1, tabs: { ALL: 1, REPLIES: 1, LIKES: 0 } });
      throw new Error(`Unexpected action: ${action}`);
    }
  });

  service.readActivity('activity-1');
  const unreadRequest = service.getActivityUnread();
  service.readActivity('activity-2');
  await flush();
  assert.deepEqual(calls, ['community.activity.read', 'community.activity.read']);

  readResolvers[0]({ activityId: 'activity-1', read: true, stale: false });
  await flush();
  assert.equal((await unreadRequest).total, 1);
  assert.deepEqual(calls, ['community.activity.read', 'community.activity.read', 'community.activity.unread']);

  readResolvers[1]({ activityId: 'activity-2', read: true, stale: false });
});
