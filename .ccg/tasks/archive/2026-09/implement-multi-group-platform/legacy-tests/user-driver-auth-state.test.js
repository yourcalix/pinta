'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const activityService = require('../miniprogram/services/activity');
const userService = require('../miniprogram/services/user');

const USER_PAGE_PATH = require.resolve('../miniprogram/pages/user/index');
const TEMPLATE_PATH = path.resolve(__dirname, '../miniprogram/pages/user/index.wxml');
const STYLE_PATH = path.resolve(__dirname, '../miniprogram/pages/user/index.wxss');

function userFixture() {
  return { profile: { nickname: '测试用户', gender: 'MALE', isAdult: true } };
}

function loadPage() {
  let definition;
  global.Page = (value) => { definition = value; };
  global.wx = {
    getStorageSync() { return true; },
    setStorageSync() {},
    showModal() {},
    navigateTo() {}
  };
  delete require.cache[USER_PAGE_PATH];
  require(USER_PAGE_PATH);
  return {
    ...definition,
    data: { ...definition.data },
    setData(value) { Object.assign(this.data, value); }
  };
}

function unloadPage() {
  delete require.cache[USER_PAGE_PATH];
  delete global.Page;
  delete global.wx;
}

function replaceServices(overrides = {}) {
  const originals = {
    login: userService.login,
    getStudentVerification: userService.getStudentVerification,
    mine: userService.mine,
    notifications: userService.notifications,
    getDriverApplication: userService.getDriverApplication,
    driverProfile: activityService.driverProfile,
    driverMine: activityService.driverMine
  };
  userService.login = async () => userFixture();
  userService.getStudentVerification = async () => ({ verification: { status: 'APPROVED' } });
  userService.mine = async () => ({ owned: [], joined: [] });
  userService.notifications = async () => ({ items: [] });
  userService.getDriverApplication = async () => ({ application: null });
  activityService.driverProfile = async () => ({ driver: null });
  activityService.driverMine = async () => ({ items: [] });
  Object.assign(userService, overrides.userService || {});
  Object.assign(activityService, overrides.activityService || {});
  return () => {
    Object.assign(userService, {
      login: originals.login,
      getStudentVerification: originals.getStudentVerification,
      mine: originals.mine,
      notifications: originals.notifications,
      getDriverApplication: originals.getDriverApplication
    });
    Object.assign(activityService, {
      driverProfile: originals.driverProfile,
      driverMine: originals.driverMine
    });
  };
}

test('司机认证接口失败时进入不可用态而不是伪装成未提交', async () => {
  const restore = replaceServices({
    userService: { getDriverApplication: async () => { throw new Error('network failed'); } },
    activityService: { driverProfile: async () => { throw new Error('network failed'); } }
  });
  const page = loadPage();
  try {
    await page.loadDashboard();
    assert.equal(page.data.studentVerified, true);
    assert.equal(page.data.driverAuthLoadState, 'error');
    assert.equal(page.data.driverApplication, null);
    assert.equal(page.data.driverApplicationView.action, '开始司机认证');
    const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    assert.match(template, /driverAuthLoadState === 'error'/);
    assert.match(template, /司机认证状态暂不可用/);
    assert.match(template, /wx:elif="\{\{!driverProfile \|\| !driverProfile\.canAcceptRide\}\}"/);
  } finally {
    restore();
    unloadPage();
  }
});

test('司机认证接口成功且明确无申请时才进入开始认证态', async () => {
  const restore = replaceServices();
  const page = loadPage();
  try {
    await page.loadDashboard();
    assert.equal(page.data.driverAuthLoadState, 'ready');
    assert.equal(page.data.driverProfile, null);
    assert.equal(page.data.driverApplication, null);
    assert.equal(page.data.driverApplicationView.action, '开始司机认证');
    assert.equal(page.data.driverApplicationView.tone, 'primary');
    const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    const styles = fs.readFileSync(STYLE_PATH, 'utf8');
    assert.match(template, /driver-guide-top/);
    assert.match(template, /driver-guide-btn--\{\{driverApplicationView\.tone\}\}/);
    assert.match(template, /hover-class="driver-guide-btn--hover"/);
    assert.match(styles, /\.driver-guide-car[\s\S]*width:\s*140rpx;[\s\S]*height:\s*116rpx;/);
    assert.match(styles, /\.driver-guide-info[\s\S]*min-width:\s*0;/);
    assert.match(styles, /\.driver-guide-btn[\s\S]*background:\s*#16a36a;/);
    assert.match(styles, /\.driver-guide-btn::after[\s\S]*display:\s*none;/);
  } finally {
    restore();
    unloadPage();
  }
});

test('司机任务加载失败不覆盖已经通过的司机资格', async () => {
  const driver = { canAcceptRide: true, vehicles: [{ id: 'vehicle-1' }] };
  const restore = replaceServices({
    userService: { getDriverApplication: async () => { throw new Error('application unavailable'); } },
    activityService: {
      driverProfile: async () => ({ driver }),
      driverMine: async () => { throw new Error('task unavailable'); }
    }
  });
  const page = loadPage();
  try {
    await page.loadDashboard();
    assert.equal(page.data.driverAuthLoadState, 'ready');
    assert.equal(page.data.driverProfile, driver);
    assert.equal(page.data.driverTasksLoadState, 'error');
    assert.deepEqual(page.data.driverRides, []);
  } finally {
    restore();
    unloadPage();
  }
});

test('学生未认证或学生接口不可用时仍独立加载已通过司机资格与任务', async () => {
  for (const verificationMode of ['not-submitted', 'unavailable']) {
    let driverMineCalls = 0;
    const driver = { canAcceptRide: true, vehicles: [{ id: 'vehicle-1' }] };
    const restore = replaceServices({
      userService: {
        getStudentVerification: verificationMode === 'unavailable'
          ? async () => { throw Object.assign(new Error('接口动作不存在'), { code: 'ACTION_NOT_FOUND' }); }
          : async () => ({ verification: null }),
        mine: async () => { throw new Error('student dashboard must stay locked'); },
        notifications: async () => { throw new Error('student notifications must stay locked'); }
      },
      activityService: {
        driverProfile: async () => ({ driver }),
        driverMine: async () => { driverMineCalls += 1; return { items: [] }; }
      }
    });
    const page = loadPage();
    try {
      await page.loadDashboard();
      assert.equal(page.data.studentVerified, false, verificationMode);
      assert.equal(page.data.studentDataLoadState, 'idle', verificationMode);
      assert.equal(page.data.driverAuthLoadState, 'ready', verificationMode);
      assert.equal(page.data.driverTasksLoadState, 'ready', verificationMode);
      assert.equal(page.data.driverProfile, driver, verificationMode);
      assert.equal(driverMineCalls, 1, verificationMode);
    } finally {
      restore();
      unloadPage();
    }
  }
});
