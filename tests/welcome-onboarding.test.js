'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPinbaService } = require('../cloudfunctions/api/lib/service');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');
const { CloudStore } = require('../cloudfunctions/api/lib/cloud-store');
const mockServer = require('../miniprogram/mocks/server');
const {
  WELCOME_CAMPAIGN,
  WELCOME_VARIANTS
} = require('../cloudfunctions/api/lib/welcome');

const ROOT = path.join(__dirname, '../miniprogram');

function setup(seed = {}) {
  let sequence = 0;
  const store = new MemoryStore(seed);
  const service = createPinbaService({
    store,
    clock: () => new Date('2026-09-22T04:00:00.000Z'),
    idGenerator: () => `welcome-${++sequence}`
  });
  const call = (action, data, actorId, idempotencyKey) => service.execute({
    action,
    data: data || {},
    requestId: `welcome-request-${++sequence}`,
    ...(idempotencyKey ? { idempotencyKey } : {})
  }, { actorId });
  return { store, call };
}

test('功能上线后首次创建的账号稳定获得一个欢迎变体', async () => {
  const { store, call } = setup();
  const first = await call('auth.login', {}, 'new-user');
  const second = await call('auth.login', {}, 'new-user');
  assert.equal(first.ok, true);
  assert.equal(first.data.welcome.ipSplash.campaign, WELCOME_CAMPAIGN);
  assert.equal(first.data.welcome.ipSplash.pending, true);
  assert.ok(WELCOME_VARIANTS.includes(first.data.welcome.ipSplash.variant));
  assert.deepEqual(second.data.welcome, first.data.welcome);
  assert.equal(store.users.get('new-user').welcome.ipSplash.status, 'PENDING');
});

test('欢迎确认幂等消费后跨登录永久保持已读', async () => {
  const { call } = setup();
  const login = await call('auth.login', {}, 'new-user');
  const assigned = login.data.welcome.ipSplash;
  const input = { campaign: assigned.campaign, variant: assigned.variant };
  const firstAck = await call('welcome.ack', input, 'new-user', 'welcome-ack-new-user');
  const replayAck = await call('welcome.ack', input, 'new-user', 'welcome-ack-new-user-replay');
  assert.equal(firstAck.ok, true);
  assert.equal(replayAck.ok, true);
  assert.equal(firstAck.data.welcome.ipSplash.pending, false);
  const after = await call('auth.login', {}, 'new-user');
  assert.deepEqual(after.data.welcome.ipSplash, {
    campaign: WELCOME_CAMPAIGN,
    pending: false,
    variant: null
  });
});

test('功能上线前已存在且没有欢迎字段的旧账号不会被补弹', async () => {
  const oldUser = {
    id: 'old-user',
    role: 'user',
    status: 'ACTIVE',
    profile: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
  const { store, call } = setup({ users: [oldUser] });
  const login = await call('auth.login', {}, 'old-user');
  assert.deepEqual(login.data.welcome.ipSplash, {
    campaign: WELCOME_CAMPAIGN,
    pending: false,
    variant: null
  });
  assert.equal(store.users.get('old-user').welcome, undefined);
});

test('欢迎变体只输出有限枚举且不会泄露用户标识', async () => {
  const variants = new Set();
  for (let index = 0; index < 48; index += 1) {
    const { call } = setup();
    const actorId = `private-openid-${index}`;
    const login = await call('auth.login', {}, actorId);
    variants.add(login.data.welcome.ipSplash.variant);
    assert.equal(JSON.stringify(login.data.welcome).includes(actorId), false);
  }
  assert.ok(variants.size >= 4);
});

test('CloudStore 只通过用户文档事务幂等确认欢迎卡片', async () => {
  const actorId = 'cloud-new-user';
  const userDocument = {
    _id: actorId,
    role: 'user',
    status: 'ACTIVE',
    welcome: {
      ipSplash: {
        campaign: WELCOME_CAMPAIGN,
        variant: 'FOOD',
        status: 'PENDING',
        assignedAt: '2026-09-22T03:00:00.000Z',
        seenAt: null
      }
    }
  };
  let updateCount = 0;
  const reference = {
    async get() { return { data: { ...userDocument } }; },
    async update({ data }) {
      updateCount += 1;
      Object.assign(userDocument, data);
    }
  };
  const transaction = {
    collection(name) {
      assert.equal(name, 'users');
      return { doc(id) { assert.equal(id, actorId); return reference; } };
    }
  };
  const store = new CloudStore({
    database() {
      return {
        command: {},
        async runTransaction(callback) { return callback(transaction); }
      };
    }
  });
  const input = { campaign: WELCOME_CAMPAIGN, variant: 'FOOD' };
  const first = await store.acknowledgeWelcome(actorId, input, '2026-09-22T04:00:00.000Z');
  const second = await store.acknowledgeWelcome(actorId, input, '2026-09-22T04:01:00.000Z');
  assert.equal(first.welcome.ipSplash.status, 'SEEN');
  assert.equal(second.welcome.ipSplash.status, 'SEEN');
  assert.equal(updateCount, 1);
});

test('Mock 新用户演示人格也遵循一次展示与幂等确认', async () => {
  mockServer.reset();
  assert.equal(mockServer.setPersona('u_newcomer'), true);
  const login = await mockServer.call({ action: 'auth.login', data: {}, requestId: 'mock-welcome-login' });
  assert.equal(login.ok, true);
  assert.equal(login.data.welcome.ipSplash.pending, true);
  const welcome = login.data.welcome.ipSplash;
  const ack = await mockServer.call({
    action: 'welcome.ack',
    data: { campaign: welcome.campaign, variant: welcome.variant },
    requestId: 'mock-welcome-ack',
    idempotencyKey: 'mock-welcome-ack-key'
  });
  assert.equal(ack.ok, true);
  assert.equal(ack.data.welcome.ipSplash.pending, false);
  const after = await mockServer.call({ action: 'auth.login', data: {}, requestId: 'mock-welcome-login-after' });
  assert.equal(after.data.welcome.ipSplash.pending, false);
  mockServer.reset();
});

test('本会话防重复标记在账号作用域变化时立即清空', async () => {
  const api = require('../miniprogram/services/api');
  const userService = require('../miniprogram/services/user');
  const originalInvoke = api.invoke;
  const originalSetActorScope = api.setActorScope;
  const originalGetApp = global.getApp;
  const app = {
    globalData: {
      sessionScope: 'session-a',
      welcomeHandledCampaigns: { [WELCOME_CAMPAIGN]: true }
    }
  };
  const responses = [
    { sessionScope: 'session-a', user: { status: 'ACTIVE' }, onboarding: {}, welcome: { ipSplash: { pending: false } } },
    { sessionScope: 'session-b', user: { status: 'ACTIVE' }, onboarding: {}, welcome: { ipSplash: { pending: true, campaign: WELCOME_CAMPAIGN, variant: 'HOST' } } }
  ];
  api.invoke = async () => responses.shift();
  api.setActorScope = () => {};
  global.getApp = () => app;
  try {
    await userService.login();
    assert.equal(app.globalData.welcomeHandledCampaigns[WELCOME_CAMPAIGN], true);
    await userService.login();
    assert.deepEqual(app.globalData.welcomeHandledCampaigns, {});
    assert.equal(app.globalData.sessionScope, 'session-b');
  } finally {
    api.invoke = originalInvoke;
    api.setActorScope = originalSetActorScope;
    if (originalGetApp === undefined) delete global.getApp;
    else global.getApp = originalGetApp;
  }
});

test('首页通过分包异步组件承载欢迎图且禁止裁切', () => {
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  const discoverConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'pages/discover/index.json'), 'utf8'));
  const template = fs.readFileSync(path.join(ROOT, 'pages/discover/index.wxml'), 'utf8');
  const componentRoot = path.join(ROOT, 'subpackages/onboarding/components/leju-welcome-modal');
  const componentTemplate = fs.readFileSync(path.join(componentRoot, 'index.wxml'), 'utf8');
  const componentStyle = fs.readFileSync(path.join(componentRoot, 'index.wxss'), 'utf8');
  const onboarding = app.subPackages.find((item) => item.root === 'subpackages/onboarding');
  assert.ok(onboarding);
  assert.equal(discoverConfig.usingComponents['leju-welcome-modal'], '/subpackages/onboarding/components/leju-welcome-modal/index');
  assert.equal(discoverConfig.componentPlaceholder['leju-welcome-modal'], 'view');
  assert.match(template, /<leju-welcome-modal/);
  assert.match(componentTemplate, /mode="widthFix"/);
  assert.doesNotMatch(componentTemplate, /aspectFill/);
  assert.match(componentStyle, /width:\s*72vw/);
  assert.match(componentStyle, /@media\s*\(max-height:\s*680px\)/);
  assert.match(componentStyle, /\.welcome-modal__close::after,[\s\S]*\.welcome-modal__start::after\s*\{[\s\S]*border:\s*none\s*!important/);
  assert.doesNotMatch(componentTemplate, /稍后再看/);
  assert.match(app.preloadRule['pages/discover/index'].packages.join(','), /subpackages\/onboarding/);
  assert.match(fs.readFileSync(path.join(ROOT, 'pages/discover/index.js'), 'utf8'), /appPresence\.ready\(\)/);
});

test('欢迎分包只包含六张 640px Baseline JPEG 并保留原始比例', () => {
  const assetRoot = path.join(ROOT, 'subpackages/onboarding/components/leju-welcome-modal/assets');
  const files = fs.readdirSync(assetRoot).filter((file) => file.endsWith('.jpg')).sort();
  assert.deepEqual(files, ['adventure.jpg', 'elves.jpg', 'food.jpg', 'host.jpg', 'sport.jpg', 'world.jpg']);
  for (const file of files) {
    const bytes = fs.readFileSync(path.join(assetRoot, file));
    assert.equal(bytes[0], 0xff);
    assert.equal(bytes[1], 0xd8);
    const dimensions = readJpegDimensions(bytes);
    assert.deepEqual(dimensions, [640, 1137]);
    assert.equal(isProgressiveJpeg(bytes), false);
  }
});

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

function isProgressiveJpeg(bytes) {
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xc2) return true;
    if (marker === 0xda || marker === 0xd9) return false;
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  return false;
}
