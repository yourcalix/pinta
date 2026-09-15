'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createAppPresenceManager } = require('../miniprogram/services/app-presence');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('App前台自动登录并让资料未完善的ACTIVE账号进入Presence', async () => {
  const calls = [];
  const manager = createAppPresenceManager({
    login: async () => ({ status: 'ACTIVE', profileComplete: false }),
    enter: async () => { calls.push('enter'); return { joined: true, sessionToken: 'session-active' }; },
    heartbeat: async () => ({ joined: true }),
    leave: async (token) => { calls.push(`leave:${token}`); },
    setInterval: () => 1,
    clearInterval: () => {}
  });
  await manager.show();
  assert.deepEqual(calls, ['enter']);
  manager.hide();
  await Promise.resolve();
  assert.deepEqual(calls, ['enter', 'leave:session-active']);
  assert.equal(manager.inspect().foreground, false);
  assert.equal(Object.prototype.hasOwnProperty.call(manager.inspect(), 'sessionToken'), false);
});

test('游客登录失败不进入Presence且不向用户弹错', async () => {
  let entered = 0;
  const manager = createAppPresenceManager({
    login: async () => { throw Object.assign(new Error('offline'), { code: 'INTERNAL' }); },
    enter: async () => { entered += 1; },
    heartbeat: async () => ({ joined: true }),
    leave: async () => {},
    setInterval: () => 1,
    clearInterval: () => {}
  });
  await manager.show();
  assert.equal(entered, 0);
  assert.equal(manager.inspect().online, false);
});

test('前台首次登录瞬时失败后会定时重试并自动进入Presence', async () => {
  let retry;
  let attempts = 0;
  const manager = createAppPresenceManager({
    login: async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('offline'), { code: 'INTERNAL' });
      return { status: 'ACTIVE' };
    },
    enter: async () => ({ joined: true, sessionToken: 'retried-session' }),
    heartbeat: async () => ({ joined: true }),
    leave: async () => {},
    setInterval: (callback) => { retry = callback; return attempts; },
    clearInterval: () => {}
  });
  await manager.show();
  assert.equal(manager.inspect().online, false);
  await retry();
  assert.equal(attempts, 2);
  assert.equal(manager.inspect().online, true);
});

test('心跳确认账号停用时立即清理本地会话并退出Presence', async () => {
  let heartbeatTick;
  const leaves = [];
  const manager = createAppPresenceManager({
    login: async () => ({ status: 'ACTIVE' }),
    enter: async () => ({ joined: true, sessionToken: 'disabled-session' }),
    heartbeat: async () => { throw Object.assign(new Error('disabled'), { code: 'ACCOUNT_DISABLED' }); },
    leave: async (token) => { leaves.push(token); },
    setInterval: (callback) => { heartbeatTick = callback; return 1; },
    clearInterval: () => {}
  });
  await manager.show();
  await heartbeatTick();
  await Promise.resolve();
  assert.equal(manager.inspect().online, false);
  assert.deepEqual(leaves, ['disabled-session']);
});

test('旧enter晚到后台时立即释放，不能启动心跳', async () => {
  const pending = deferred();
  const left = [];
  let intervals = 0;
  const manager = createAppPresenceManager({
    login: async () => ({ status: 'ACTIVE' }),
    enter: () => pending.promise,
    heartbeat: async () => ({ joined: true }),
    leave: async (token) => { left.push(token); },
    setInterval: () => { intervals += 1; return intervals; },
    clearInterval: () => {}
  });
  const showing = manager.show();
  await Promise.resolve();
  manager.hide();
  pending.resolve({ joined: true, sessionToken: 'late-session' });
  await showing;
  await Promise.resolve();
  assert.deepEqual(left, ['late-session']);
  assert.equal(intervals, 0);
  assert.equal(manager.inspect().online, false);
});

test('快速前后台切换时旧leave不清理新会话', async () => {
  const leaves = [];
  let sequence = 0;
  const manager = createAppPresenceManager({
    login: async () => ({ status: 'ACTIVE' }),
    enter: async () => ({ joined: true, sessionToken: `session-${++sequence}` }),
    heartbeat: async () => ({ joined: true }),
    leave: async (token) => { leaves.push(token); },
    setInterval: () => sequence,
    clearInterval: () => {}
  });
  await manager.show();
  manager.hide();
  await manager.show();
  assert.deepEqual(leaves, ['session-1']);
  assert.equal(manager.inspect().online, true);
  assert.equal(manager.inspect().epoch, 3);
});

test('App生命周期接管Presence且会话凭据不进入globalData或Storage', () => {
  const app = fs.readFileSync(path.join(__dirname, '../miniprogram/app.js'), 'utf8');
  const manager = fs.readFileSync(path.join(__dirname, '../miniprogram/services/app-presence.js'), 'utf8');
  assert.match(app, /appPresence\.show\(\)/);
  assert.match(app, /appPresence\.hide\(\)/);
  assert.doesNotMatch(app, /sessionToken/);
  assert.doesNotMatch(manager, /setStorage|globalData|navigateTo|showToast/);
});
