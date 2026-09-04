'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const activityService = require('../miniprogram/services/activity');
const userService = require('../miniprogram/services/user');

const root = path.join(__dirname, '..');

function loadDetailPage() {
  let definition;
  global.Page = (value) => { definition = value; };
  global.wx = {
    showShareMenu() {},
    switchTab() {},
    showToast() {},
    showModal() {},
    navigateTo() {}
  };
  const pagePath = require.resolve('../miniprogram/subpackages/activity/detail/index');
  delete require.cache[pagePath];
  require(pagePath);
  return {
    pagePath,
    page: {
      ...definition,
      data: { ...definition.data },
      setData(value) { Object.assign(this.data, value); }
    }
  };
}

function unloadDetailPage(pagePath) {
  delete require.cache[pagePath];
  delete global.Page;
  delete global.wx;
}

function publicRide(id, title = '周末同行活动') {
  return {
    id,
    type: 'ride',
    title,
    description: '公开活动说明',
    city: '上海',
    district: '浦东新区',
    placeLabel: '张江地铁站',
    startsAt: new Date(Date.now() + 7200000).toISOString(),
    deadlineAt: new Date(Date.now() + 3600000).toISOString(),
    targetMembers: 2,
    memberCount: 1,
    status: 'RECRUITING',
    owner: { nickname: '发起者' },
    rules: '公开规则',
    typeData: {
      origin: '张江',
      destination: '陆家嘴',
      feeType: 'SHARED_COST',
      luggageRule: 'ONE_SMALL'
    },
    viewerRole: 'guest'
  };
}

test('缺失或畸形分享参数结束骨架屏并进入不可恢复 NOT_FOUND', async () => {
  for (const options of [{}, { id: '%E0%A4%A' }]) {
    const { page, pagePath } = loadDetailPage();
    try {
      page.onLoad(options);
      await page.onShow();
      assert.equal(page.data.id, '');
      assert.equal(page.data.loading, false);
      assert.equal(page.data.errorCode, 'NOT_FOUND');
      assert.equal(page.data.activity, null);
    } finally {
      unloadDetailPage(pagePath);
    }
  }
});

test('冷启动只按分享 ID 加载公开详情且不主动登录', async () => {
  const originalDetail = activityService.detail;
  const originalLogin = userService.login;
  const requestedIds = [];
  let loginCalls = 0;
  activityService.detail = async (id) => {
    requestedIds.push(id);
    return { activity: publicRide(id) };
  };
  userService.login = async () => {
    loginCalls += 1;
    return { profile: null };
  };
  const { page, pagePath } = loadDetailPage();

  try {
    page.onLoad({ id: 'activity%2Fshared%3Fx%3D1' });
    await page.onShow();
    assert.deepEqual(requestedIds, ['activity/shared?x=1']);
    assert.equal(page.data.activity.id, 'activity/shared?x=1');
    assert.equal(loginCalls, 0);
  } finally {
    activityService.detail = originalDetail;
    userService.login = originalLogin;
    unloadDetailPage(pagePath);
  }
});

test('成功分享只包含公开标题和编码后的当前活动 ID', () => {
  const { page, pagePath } = loadDetailPage();
  try {
    page.data.id = 'activity/a?x=1';
    page.data.loading = false;
    page.data.errorCode = '';
    page.data.activity = {
      title: '周末羽毛球',
      contactInfo: '不得进入分享',
      viewerRole: 'owner',
      viewerApplication: { note: '不得进入分享' }
    };
    const payload = page.onShareAppMessage();
    assert.deepEqual(payload, {
      title: '拼吧｜周末羽毛球',
      path: '/subpackages/activity/detail/index?id=activity%2Fa%3Fx%3D1'
    });
    assert.equal(JSON.stringify(payload).includes('contactInfo'), false);
    assert.equal(JSON.stringify(payload).includes('viewerRole'), false);
    assert.equal(JSON.stringify(payload).includes('不得进入分享'), false);
  } finally {
    unloadDetailPage(pagePath);
  }
});

test('加载中、无活动或错误状态分享统一降级到发现页', () => {
  const { page, pagePath } = loadDetailPage();
  try {
    const states = [
      { loading: true, activity: null, errorCode: '' },
      { loading: false, activity: null, errorCode: '' },
      { loading: false, activity: null, errorCode: 'TIMEOUT' },
      { loading: false, activity: publicRide('a_suspended'), errorCode: 'TAKEDOWN' },
      { loading: false, activity: publicRide('missing'), errorCode: 'NOT_FOUND' }
    ];
    states.forEach((state) => {
      Object.assign(page.data, state);
      assert.deepEqual(page.onShareAppMessage(), {
        title: '拼吧｜发现有趣拼单',
        path: '/pages/discover/index'
      });
    });
  } finally {
    unloadDetailPage(pagePath);
  }
});

test('详情模板把 NOT_FOUND 设为不可恢复并提供原生分享入口', () => {
  const pageDir = path.join(root, 'miniprogram/subpackages/activity/detail');
  const template = fs.readFileSync(path.join(pageDir, 'index.wxml'), 'utf8');
  const style = fs.readFileSync(path.join(pageDir, 'index.wxss'), 'utf8');
  const appSource = fs.readFileSync(path.join(root, 'miniprogram/app.js'), 'utf8');

  assert.match(template, /errorCode === 'TAKEDOWN' \|\| errorCode === 'NOT_FOUND'/);
  assert.match(template, /open-type="share"/);
  assert.match(template, /aria-label="分享活动"/);
  assert.match(style, /\.primary-button, \.secondary-button, \.share-button\s*\{[^}]*min-height:\s*44px/);
  assert.doesNotMatch(appSource, /readiness|readyPromise|initializationPromise/);
});
