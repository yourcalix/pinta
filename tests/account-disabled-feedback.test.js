'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function clearClientModules() {
  [
    '../miniprogram/services/account-disabled-feedback',
    '../miniprogram/services/api',
    '../miniprogram/mocks/server'
  ].forEach((request) => {
    try {
      delete require.cache[require.resolve(request)];
    } catch (error) {
      // The module may not exist yet in the initial failing-test phase.
    }
  });
}

test('受限账号反馈把并发提示合并为一个 Modal 和一次返回发现', async () => {
  const { createAccountDisabledFeedback } = require('../miniprogram/services/account-disabled-feedback');
  const modals = [];
  const navigations = [];
  const feedback = createAccountDisabledFeedback({
    showModal(options) {
      modals.push(options);
    },
    switchTab(options) {
      navigations.push(options);
      options.complete();
    }
  });

  const first = feedback.present();
  const second = feedback.present();
  assert.equal(first, second);
  assert.equal(modals.length, 1);
  assert.equal(modals[0].showCancel, false);

  modals[0].complete();
  await Promise.all([first, second]);
  assert.equal(navigations.length, 1);
  assert.equal(navigations[0].url, '/pages/discover/index');

  const third = feedback.present();
  assert.equal(modals.length, 2, '完成跳转后必须释放单例锁');
  modals[1].complete();
  await third;
});

test('原生 Modal 抛错时安全降级且不会永久占用锁', async () => {
  const { createAccountDisabledFeedback } = require('../miniprogram/services/account-disabled-feedback');
  let modalCalls = 0;
  let navigationCalls = 0;
  const feedback = createAccountDisabledFeedback({
    showModal() {
      modalCalls += 1;
      throw new Error('native modal unavailable');
    },
    switchTab(options) {
      navigationCalls += 1;
      options.fail();
    }
  });

  await feedback.present();
  await feedback.present();
  assert.equal(modalCalls, 2);
  assert.equal(navigationCalls, 2);
});

test('API 拦截并发 ACCOUNT_DISABLED、清理会话且保留其他 pending 幂等键', async () => {
  const storage = {
    pinba_pending_mutations_v1: {
      'previous-unknown-operation': {
        key: 'keep-same-idempotency-key',
        createdAt: Date.now()
      }
    }
  };
  const modals = [];
  const navigations = [];
  const app = { globalData: { user: { profile: { nickname: '旧用户' } } } };

  global.wx = {
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => { storage[key] = value; },
    showModal: (options) => { modals.push(options); },
    switchTab: (options) => {
      navigations.push(options);
      options.complete();
    }
  };
  global.getApp = () => app;
  clearClientModules();

  try {
    const api = require('../miniprogram/services/api');
    api.resetMock();
    api.setMockPersona('u_disabled');
    const payload = { title: '不会写入的受限请求' };
    const errors = await Promise.all([
      api.invoke('activity.create', payload).catch((error) => error),
      api.invoke('activity.create', payload).catch((error) => error)
    ]);

    assert.equal(errors.every((error) => error.code === 'ACCOUNT_DISABLED' && error.handled === true), true);
    assert.equal(app.globalData.user, null);
    assert.equal(modals.length, 1);
    assert.equal(storage.pinba_pending_mutations_v1['previous-unknown-operation'].key, 'keep-same-idempotency-key');

    modals[0].complete();
    await flush();
    assert.equal(navigations.length, 1);
  } finally {
    clearClientModules();
    delete global.wx;
    delete global.getApp;
  }
});

test('普通业务错误不触发受限账号反馈或清理全局用户', async () => {
  const modals = [];
  const app = { globalData: { user: { profile: { nickname: '有效用户' } } } };
  global.wx = {
    getStorageSync() {},
    setStorageSync() {},
    showModal: (options) => { modals.push(options); },
    switchTab() {}
  };
  global.getApp = () => app;
  clearClientModules();

  try {
    const api = require('../miniprogram/services/api');
    api.resetMock();
    api.setMockPersona('u_owner');
    const error = await api.invoke('activity.detail', { activityId: 'missing-activity' }).catch((caught) => caught);
    assert.equal(error.code, 'NOT_FOUND');
    assert.equal(error.handled, undefined);
    assert.equal(modals.length, 0);
    assert.notEqual(app.globalData.user, null);
  } finally {
    clearClientModules();
    delete global.wx;
    delete global.getApp;
  }
});

test('受限响应会清空真实模式 actor scope，后续未知结果写请求使用未登录作用域', async () => {
  const config = require('../miniprogram/config/index');
  const originalUseMock = config.useMock;
  const storage = {};
  const modals = [];
  let callCount = 0;

  config.useMock = false;
  global.wx = {
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => { storage[key] = value; },
    cloud: {
      callFunction() {
        callCount += 1;
        if (callCount === 1) {
          return Promise.resolve({
            result: {
              ok: false,
              error: { code: 'ACCOUNT_DISABLED', message: '账号已被限制，请联系平台处理' }
            }
          });
        }
        return Promise.reject(new Error('transport result unknown'));
      }
    },
    showModal: (options) => { modals.push(options); },
    switchTab: (options) => { options.complete(); }
  };
  global.getApp = () => ({ globalData: { user: { profile: { nickname: '旧用户' } } } });
  clearClientModules();

  try {
    const api = require('../miniprogram/services/api');
    api.setActorScope('session-user-a');
    const disabled = await api.invoke('activity.create', { title: '受限请求' }).catch((error) => error);
    assert.equal(disabled.code, 'ACCOUNT_DISABLED');
    assert.equal(disabled.handled, true);
    assert.equal(modals.length, 1);
    modals[0].complete();
    await flush();

    const transportError = await api.invoke('report.create', { targetId: 'a_ride' }).catch((error) => error);
    assert.equal(transportError.message, 'transport result unknown');
    const pendingFingerprints = Object.keys(storage.pinba_pending_mutations_v1 || {});
    assert.equal(
      pendingFingerprints.some((fingerprint) => fingerprint.startsWith('unauthenticated-session:report.create:')),
      true
    );
    assert.equal(pendingFingerprints.some((fingerprint) => fingerprint.startsWith('session-user-a:')), false);
  } finally {
    config.useMock = originalUseMock;
    clearClientModules();
    delete global.wx;
    delete global.getApp;
  }
});

test('所有受保护页面识别 handled 标记且举报页始终恢复 submitting', () => {
  const protectedPages = [
    'miniprogram/pages/publish/index.js',
    'miniprogram/pages/user/index.js',
    'miniprogram/subpackages/profile/edit/index.js',
    'miniprogram/subpackages/publish/form/index.js',
    'miniprogram/subpackages/activity/detail/index.js',
    'miniprogram/subpackages/activity/manage/index.js',
    'miniprogram/subpackages/activity/group/index.js',
    'miniprogram/subpackages/safety/report/index.js'
  ];

  protectedPages.forEach((file) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, /error\.handled/, `${file} 必须抑制已统一处理的重复反馈`);
  });

  const report = fs.readFileSync(
    path.join(root, 'miniprogram/subpackages/safety/report/index.js'),
    'utf8'
  );
  assert.match(report, /finally\s*\{[\s\S]*submitting:\s*false/);
});

test('发布入口遇到已处理错误时不叠加 Toast 且恢复 pending', async () => {
  const userService = require('../miniprogram/services/user');
  const originalLogin = userService.login;
  const toasts = [];
  let definition;
  global.Page = (value) => { definition = value; };
  global.wx = {
    showToast: (options) => { toasts.push(options); },
    navigateTo() {}
  };
  userService.login = async () => {
    const error = new Error('账号已被限制');
    error.code = 'ACCOUNT_DISABLED';
    error.handled = true;
    throw error;
  };

  const pagePath = require.resolve('../miniprogram/pages/publish/index');
  delete require.cache[pagePath];
  require(pagePath);
  const page = {
    ...definition,
    data: { ...definition.data },
    setData(value) { Object.assign(this.data, value); }
  };

  try {
    await page.handleSelect({ currentTarget: { dataset: { type: 'ride' } } });
    assert.equal(page.data.pending, false);
    assert.equal(toasts.length, 0);
  } finally {
    userService.login = originalLogin;
    delete require.cache[pagePath];
    delete global.Page;
    delete global.wx;
  }
});

test('举报页跳转补资料后仍通过 finally 恢复 submitting', async () => {
  const userService = require('../miniprogram/services/user');
  const originalLogin = userService.login;
  const navigations = [];
  let definition;
  global.Page = (value) => { definition = value; };
  global.wx = {
    navigateTo: (options) => { navigations.push(options); },
    showModal() {},
    switchTab() {}
  };
  userService.login = async () => ({ profile: null });

  const pagePath = require.resolve('../miniprogram/subpackages/safety/report/index');
  delete require.cache[pagePath];
  require(pagePath);
  const page = {
    ...definition,
    data: {
      ...definition.data,
      targetId: 'activity-test',
      reason: 'FALSE_INFORMATION'
    },
    setData(value) { Object.assign(this.data, value); }
  };

  try {
    await page.handleSubmit();
    assert.equal(page.data.submitting, false);
    assert.equal(navigations.length, 1);
    assert.equal(navigations[0].url, '/subpackages/profile/edit/index');
  } finally {
    userService.login = originalLogin;
    delete require.cache[pagePath];
    delete global.Page;
    delete global.wx;
  }
});
