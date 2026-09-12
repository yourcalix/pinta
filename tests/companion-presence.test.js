'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPinbaService } = require('../cloudfunctions/api/lib/service');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');
const mockServer = require('../miniprogram/mocks/server');

function profile(nickname) {
  return { nickname, gender: 'FEMALE', city: '澳门', interests: ['运动'], adultConfirmed: true };
}

function setup() {
  let now = Date.parse('2026-09-12T08:00:00.000Z');
  let request = 0;
  const store = new MemoryStore({ users: [
    { id: 'user-a', role: 'user', status: 'ACTIVE', profile: profile('小琴') },
    { id: 'user-b', role: 'user', status: 'ACTIVE', profile: profile('阿明') },
    { id: 'incomplete', role: 'user', status: 'ACTIVE', profile: { nickname: '未完成', adultConfirmed: true } },
    { id: 'disabled', role: 'user', status: 'DISABLED', profile: profile('停用') }
  ] });
  const service = createPinbaService({ store, clock: () => new Date(now), idGenerator: () => `presence-${++request}` });
  const call = (action, actorId, key, data = {}) => service.execute({
    action,
    data: { scene: 'companion_globe', ...data },
    requestId: `presence-request-${++request}`,
    ...(key ? { idempotencyKey: key } : {})
  }, actorId ? { actorId } : {});
  return { store, call, advance: (milliseconds) => { now += milliseconds; } };
}

test('游客快照不创建在线事实，只有合格账号主动加入才计数', async () => {
  const { store, call } = setup();
  const guest = await call('companion.presence.snapshot');
  assert.equal(guest.ok, true);
  assert.deepEqual(guest.data, { onlineTotal: 0, sampleLimit: 50, users: [], serverNow: '2026-09-12T08:00:00.000Z' });
  assert.equal(store.companionPresences.size, 0);

  assert.equal((await call('companion.presence.enter', null, 'presence-enter-guest')).error.code, 'UNAUTHENTICATED');
  assert.equal((await call('companion.presence.enter', 'incomplete', 'presence-enter-incomplete')).error.code, 'PROFILE_INCOMPLETE');
  assert.equal((await call('companion.presence.enter', 'disabled', 'presence-enter-disabled')).error.code, 'ACCOUNT_DISABLED');

  const joined = await call('companion.presence.enter', 'user-a', 'presence-enter-user-a');
  assert.equal(joined.ok, true);
  assert.equal(joined.data.joined, true);
  assert.equal(joined.data.sessionTtlSec, 90);
  assert.equal(joined.data.heartbeatIntervalSec, 30);
  assert.ok(joined.data.sessionToken);
  const retried = await call('companion.presence.enter', 'user-a', 'presence-enter-user-a');
  assert.equal(retried.data.sessionToken, joined.data.sessionToken);
  assert.equal(retried.idempotentReplay, true);
  assert.equal(joined.data.snapshot.onlineTotal, 1);
  assert.equal(joined.data.snapshot.users[0].nickname, '小琴');
  assert.equal(joined.data.snapshot.users[0].viewerIsSelf, true);
  const serialized = JSON.stringify(joined.data.snapshot);
  for (const forbidden of ['user-a', 'openid', 'contactInfo', 'birthDate', 'avatar']) assert.equal(serialized.includes(forbidden), false);
});

test('在线事实按确定性用户记录续期、限频、退出并由服务端时间过期', async () => {
  const { store, call, advance } = setup();
  const entered = await call('companion.presence.enter', 'user-a', 'presence-enter-user-a-2');
  const sessionToken = entered.data.sessionToken;
  assert.equal(store.companionPresences.size, 1);
  const firstExpiresAt = [...store.companionPresences.values()][0].expiresAt;

  advance(10_000);
  const throttled = await call('companion.presence.heartbeat', 'user-a', 'presence-heartbeat-user-a-1', { sessionToken });
  assert.equal(throttled.ok, true);
  assert.equal(throttled.data.refreshed, false);
  assert.equal([...store.companionPresences.values()][0].expiresAt, firstExpiresAt);

  advance(20_000);
  const refreshed = await call('companion.presence.heartbeat', 'user-a', 'presence-heartbeat-user-a-2', { sessionToken });
  assert.equal(refreshed.data.refreshed, true);
  assert.notEqual([...store.companionPresences.values()][0].expiresAt, firstExpiresAt);

  const reentered = await call('companion.presence.enter', 'user-a', 'presence-enter-user-a-3');
  assert.equal(store.companionPresences.size, 1);
  const left = await call('companion.presence.leave', 'user-a', 'presence-leave-user-a', { sessionToken: reentered.data.sessionToken });
  assert.equal(left.data.joined, false);
  assert.equal((await call('companion.presence.snapshot')).data.onlineTotal, 0);

  await call('companion.presence.enter', 'user-b', 'presence-enter-user-b');
  advance(91_000);
  assert.equal((await call('companion.presence.snapshot')).data.onlineTotal, 0);
});

test('同一账号重新加入会轮换公开会话标识，停用后仍可立即退出隐身', async () => {
  const { store, call } = setup();
  const first = await call('companion.presence.enter', 'user-a', 'presence-enter-session-1');
  const firstNode = first.data.snapshot.users[0];
  await call('companion.presence.leave', 'user-a', 'presence-leave-session-1', { sessionToken: first.data.sessionToken });
  const second = await call('companion.presence.enter', 'user-a', 'presence-enter-session-2');
  const secondNode = second.data.snapshot.users[0];
  assert.notEqual(secondNode.displayToken, firstNode.displayToken);
  assert.notEqual(secondNode.layoutSeed, firstNode.layoutSeed);

  await call('companion.presence.leave', 'user-a', 'presence-stale-leave-session-1', { sessionToken: first.data.sessionToken });
  assert.equal((await call('companion.presence.snapshot')).data.onlineTotal, 1);

  store.users.get('user-a').status = 'DISABLED';
  const leftWhileDisabled = await call('companion.presence.leave', 'user-a', 'presence-leave-disabled', { sessionToken: second.data.sessionToken });
  assert.equal(leftWhileDisabled.ok, true);
  assert.equal((await call('companion.presence.snapshot')).data.onlineTotal, 0);
});

test('公开球面样本不可分页且最多返回50个真实在线节点', async () => {
  const at = '2026-09-12T08:00:00.000Z';
  const store = new MemoryStore({ companionPresences: Array.from({ length: 70 }, (_, index) => ({
    id: `presence-${index}`,
    scene: 'companion_globe',
    userId: `internal-${index}`,
    nickname: `搭子${index}`,
    status: 'ACTIVE',
    layoutSeed: index + 1,
    lastSeenAt: at,
    expiresAt: '2026-09-12T08:01:30.000Z'
  })) });
  const service = createPinbaService({ store, clock: () => new Date(at), idGenerator: () => 'snapshot-request' });
  const result = await service.execute({ action: 'companion.presence.snapshot', data: { scene: 'companion_globe' } }, {});
  assert.equal(result.data.onlineTotal, 70);
  assert.equal(result.data.users.length, 50);
  assert.equal(Object.prototype.hasOwnProperty.call(result.data, 'nextCursor'), false);
  assert.equal(JSON.stringify(result.data).includes('internal-'), false);
});

test('Cloud presence 查询使用 scene 与 expiresAt 且不读取用户全表', () => {
  const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/api/lib/cloud-store.js'), 'utf8');
  const section = source.slice(source.indexOf('async enterCompanionPresence'), source.indexOf('async listNotifications'));
  assert.match(section, /collection\('companionPresences'\)/);
  assert.match(section, /scene/);
  assert.match(section, /expiresAt:\s*this\.command\.gt\(at\)/);
  assert.match(section, /\.count\(\)/);
  assert.match(section, /orderBy\('expiresAt', 'desc'\)\.limit\(limit\)/);
  assert.match(section, /where\(\{ _id: id, sessionNonce/);
  assert.doesNotMatch(section, /collection\('users'\)/);
});

test('客户端不会把在线会话令牌明文写入待重试 Storage 指纹', () => {
  const source = fs.readFileSync(path.join(__dirname, '../miniprogram/services/api.js'), 'utf8');
  const sensitive = source.slice(source.indexOf('const SENSITIVE_MUTATING_ACTIONS'), source.indexOf('const sensitiveFingerprintSalt'));
  assert.match(sensitive, /'companion\.presence\.heartbeat'/);
  assert.match(sensitive, /'companion\.presence\.leave'/);
  assert.match(source, /opaqueFingerprint\(serializedData\)/);
});

test('Mock 与真实服务保持主动加入、公开快照和退出语义一致', async (t) => {
  mockServer.reset();
  t.after(() => mockServer.reset());
  mockServer.setPersona('u_owner');

  const before = await mockServer.call({
    action: 'companion.presence.snapshot',
    requestId: 'mock-companion-snapshot-before',
    data: { scene: 'companion_globe' }
  });
  assert.equal(before.ok, true);
  assert.equal(before.data.onlineTotal, 0);

  const entered = await mockServer.call({
    action: 'companion.presence.enter',
    requestId: 'mock-companion-enter',
    idempotencyKey: 'mock-companion-enter-key',
    data: { scene: 'companion_globe' }
  });
  assert.equal(entered.ok, true);
  assert.equal(entered.data.snapshot.onlineTotal, 1);
  assert.equal(entered.data.snapshot.users[0].viewerIsSelf, true);
  const serialized = JSON.stringify(entered.data.snapshot);
  for (const forbidden of ['u_owner', 'openid', 'contactInfo', 'birthDate', 'avatar']) {
    assert.equal(serialized.includes(forbidden), false);
  }

  const left = await mockServer.call({
    action: 'companion.presence.leave',
    requestId: 'mock-companion-leave',
    idempotencyKey: 'mock-companion-leave-key',
    data: { scene: 'companion_globe', sessionToken: entered.data.sessionToken }
  });
  assert.equal(left.ok, true);
  assert.equal(left.data.joined, false);
  const after = await mockServer.call({
    action: 'companion.presence.snapshot',
    requestId: 'mock-companion-snapshot-after',
    data: { scene: 'companion_globe' }
  });
  assert.equal(after.data.onlineTotal, 0);

  mockServer.setPersona('u_disabled');
  const disabledLeave = await mockServer.call({
    action: 'companion.presence.leave',
    requestId: 'mock-companion-disabled-leave',
    idempotencyKey: 'mock-companion-disabled-leave-key',
    data: { scene: 'companion_globe', sessionToken: 'disabled-cleanup-token' }
  });
  assert.equal(disabledLeave.ok, true);
});
