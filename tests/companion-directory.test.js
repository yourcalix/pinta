'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPinbaService } = require('../cloudfunctions/api/lib/service');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');
const mockServer = require('../miniprogram/mocks/server');

function profile(nickname) {
  return { nickname, gender: 'FEMALE', city: '澳门', interests: ['散步'], birthDate: '2000-09-13', mbti: 'INFP', adultConfirmed: true };
}

function setup() {
  let now = Date.parse('2026-09-15T08:00:00.000Z');
  let sequence = 0;
  const store = new MemoryStore({ users: [
    { id: 'user-a', role: 'user', status: 'ACTIVE', profile: profile('小琴'), createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'user-b', role: 'user', status: 'ACTIVE', profile: profile('阿明'), createdAt: '2026-01-02T00:00:00.000Z' },
    { id: 'incomplete', role: 'user', status: 'ACTIVE', profile: { nickname: '未完成', adultConfirmed: true }, createdAt: '2026-01-03T00:00:00.000Z' },
    { id: 'disabled', role: 'user', status: 'DISABLED', profile: profile('停用'), createdAt: '2026-01-04T00:00:00.000Z' }
  ] });
  const service = createPinbaService({ store, clock: () => new Date(now), idGenerator: () => `directory-${++sequence}` });
  const call = (action, data = {}, actorId, idempotencyKey) => service.execute({
    action,
    data,
    requestId: `directory-request-${++sequence}`,
    ...(idempotencyKey ? { idempotencyKey } : {})
  }, actorId ? { actorId } : {});
  return { store, call, advance: (milliseconds) => { now += milliseconds; } };
}

test('搭子目录展示所有可公开账号，在线人数只来自Presence', async () => {
  const { call } = setup();
  const before = await call('companion.directory.snapshot', { scene: 'companion_globe' });
  assert.equal(before.ok, true);
  assert.equal(before.data.onlineTotal, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(before.data, 'directoryTotal'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(before.data, 'sampleLimit'), false);
  assert.deepEqual(before.data.users.map((item) => item.nickname).sort(), ['小琴', '阿明', '未完成'].sort());
  assert.equal(before.data.users.every((item) => /^companionDirView_[a-f0-9]{56}$/.test(item.displayToken)), true);
  assert.equal(before.data.users.every((item) => !item.profileNavToken && Number.isInteger(item.layoutSeed)), true);
  const serialized = JSON.stringify(before.data);
  for (const forbidden of ['user-a', 'user-b', 'disabled', 'openid', 'birthDate', 'contactInfo', 'avatar']) {
    assert.equal(serialized.includes(forbidden), false);
  }

  await call('companion.presence.enter', { scene: 'companion_globe' }, 'user-a', 'directory-enter-user-a');
  const active = await call('companion.directory.snapshot', { scene: 'companion_globe' }, 'user-a');
  assert.equal(active.data.onlineTotal, 1);
  assert.equal(active.data.users.find((item) => item.nickname === '小琴').viewerIsSelf, true);
});

test('退出寻找只减少在线人数，不会把账号从搭子目录移除', async () => {
  const { call } = setup();
  const entered = await call('companion.presence.enter', { scene: 'companion_globe' }, 'user-a', 'directory-enter-leave');
  await call('companion.presence.leave', { scene: 'companion_globe', sessionToken: entered.data.sessionToken }, 'user-a', 'directory-leave');
  const snapshot = await call('companion.directory.snapshot', { scene: 'companion_globe' });
  assert.equal(snapshot.data.onlineTotal, 0);
  assert.equal(snapshot.data.users.some((item) => item.nickname === '小琴'), true);
});

test('首次登录创建的活跃账号立即进入目录但不会被算作在线', async () => {
  const { call } = setup();
  const login = await call('auth.login', {}, 'new-login');
  assert.equal(login.ok, true);
  const snapshot = await call('companion.directory.snapshot', { scene: 'companion_globe' }, 'new-login');
  assert.equal(snapshot.data.onlineTotal, 0);
  const node = snapshot.data.users.find((item) => item.viewerIsSelf);
  assert.ok(node);
  assert.equal(node.nickname, '匿名搭子');
});

test('目录节点点击后才签发访问者绑定票据，离线用户主页不声明在线', async () => {
  const { call } = setup();
  const snapshot = await call('companion.directory.snapshot', { scene: 'companion_globe' }, 'user-a');
  const targetNode = snapshot.data.users.find((item) => item.nickname === '阿明');
  const issued = await call('companion.directory.profile.nav.create', {
    scene: 'companion_globe', displayToken: targetNode.displayToken
  }, 'user-a', 'directory-profile-nav-create');
  assert.equal(issued.ok, true);
  assert.equal(issued.data.target, 'public');
  assert.match(issued.data.profileNavToken, /^directoryProfileNa_[a-f0-9]{64}$/);

  const opened = await call('profile.public.get', { profileNavToken: issued.data.profileNavToken }, 'user-a');
  assert.equal(opened.ok, true);
  assert.equal(opened.data.profile.nickname, '阿明');
  assert.equal(opened.data.profile.online, false);
  assert.equal(opened.data.profile.viewerIsSelf, false);
  const serialized = JSON.stringify(opened.data);
  for (const forbidden of ['user-b', 'openid', 'birthDate', 'contactInfo', 'fileID']) assert.equal(serialized.includes(forbidden), false);

  const foreign = await call('profile.public.get', { profileNavToken: issued.data.profileNavToken }, 'user-b');
  assert.equal(foreign.error.code, 'NOT_FOUND');
  const selfNode = snapshot.data.users.find((item) => item.nickname === '小琴');
  const self = await call('companion.directory.profile.nav.create', {
    scene: 'companion_globe', displayToken: selfNode.displayToken
  }, 'user-a', 'directory-profile-nav-self');
  assert.deepEqual(self.data, { target: 'self' });
});

test('目录节点短时令牌、账号状态和公开资料均在导航时重新校验', async () => {
  const { store, call, advance } = setup();
  const snapshot = await call('companion.directory.snapshot', { scene: 'companion_globe' }, 'user-a');
  const targetNode = snapshot.data.users.find((item) => item.nickname === '阿明');
  const invalid = await call('companion.directory.profile.nav.create', {
    scene: 'companion_globe', displayToken: `${targetNode.displayToken.slice(0, -1)}0`
  }, 'user-a', 'directory-profile-nav-invalid');
  assert.equal(invalid.error.code, 'NOT_FOUND');

  advance(10 * 60 * 1000 + 1);
  const expired = await call('companion.directory.profile.nav.create', {
    scene: 'companion_globe', displayToken: targetNode.displayToken
  }, 'user-a', 'directory-profile-nav-expired');
  assert.equal(expired.error.code, 'NOT_FOUND');

  const fresh = await call('companion.directory.snapshot', { scene: 'companion_globe' }, 'user-a');
  const freshTarget = fresh.data.users.find((item) => item.nickname === '阿明');
  store.users.get('user-b').status = 'DISABLED';
  const disabled = await call('companion.directory.profile.nav.create', {
    scene: 'companion_globe', displayToken: freshTarget.displayToken
  }, 'user-a', 'directory-profile-nav-disabled');
  assert.equal(disabled.error.code, 'NOT_FOUND');
});

test('Cloud目录查询在用户集合按公开资格筛选并静默限制50条', () => {
  const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/api/lib/cloud-store.js'), 'utf8');
  const section = source.slice(source.indexOf('async snapshotCompanionDirectory'), source.indexOf('async enterCompanionPresence'));
  assert.match(section, /collection\('users'\)/);
  assert.match(section, /status:\s*'ACTIVE'/);
  assert.doesNotMatch(section, /\.count\(\)/);
  assert.match(section, /\.limit\(limit\)/);
});

test('Mock目录与真实服务保持目录、在线人数和离线主页语义一致', async (t) => {
  mockServer.reset();
  t.after(() => mockServer.reset());
  mockServer.setPersona('u_owner');
  const snapshot = await mockServer.call({
    action: 'companion.directory.snapshot', requestId: 'mock-directory-snapshot', data: { scene: 'companion_globe' }
  });
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.data.onlineTotal, 0);
  const target = snapshot.data.users.find((item) => !item.viewerIsSelf);
  const issued = await mockServer.call({
    action: 'companion.directory.profile.nav.create', requestId: 'mock-directory-nav', idempotencyKey: 'mock-directory-nav-key',
    data: { scene: 'companion_globe', displayToken: target.displayToken }
  });
  assert.equal(issued.ok, true);
  const opened = await mockServer.call({
    action: 'profile.public.get', requestId: 'mock-directory-open', data: { profileNavToken: issued.data.profileNavToken }
  });
  assert.equal(opened.ok, true);
  assert.equal(opened.data.profile.online, false);
});
