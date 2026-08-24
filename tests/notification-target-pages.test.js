'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const activityService = require('../miniprogram/services/activity');
const { resolveProtectedPageError } = require('../miniprogram/utils/protected-page-error');

const root = path.join(__dirname, '..');

function loadPage(request) {
  let definition;
  const redirects = [];
  const tabSwitches = [];
  global.Page = (value) => { definition = value; };
  global.wx = {
    redirectTo: (options) => { redirects.push(options); },
    switchTab: (options) => { tabSwitches.push(options); },
    showModal() {},
    showToast() {},
    navigateTo() {}
  };
  const pagePath = require.resolve(request);
  delete require.cache[pagePath];
  require(pagePath);
  return {
    pagePath,
    redirects,
    tabSwitches,
    page: {
      ...definition,
      data: { ...definition.data },
      setData(value) { Object.assign(this.data, value); }
    }
  };
}

function unloadPage(pagePath) {
  delete require.cache[pagePath];
  delete global.Page;
  delete global.wx;
}

test('受保护目标页错误映射不展示原始 SDK 信息并给出唯一安全动作', () => {
  assert.deepEqual(resolveProtectedPageError({ code: 'NOT_FOUND' }, 'manage'), {
    errorCode: 'NOT_FOUND',
    error: '活动不存在或已失效',
    errorAction: 'DISCOVER',
    errorActionText: '返回发现页'
  });
  assert.deepEqual(resolveProtectedPageError({ code: 'FORBIDDEN' }, 'group'), {
    errorCode: 'FORBIDDEN',
    error: '仅活动成员可查看成团信息',
    errorAction: 'DETAIL',
    errorActionText: '查看活动详情'
  });
  const unknown = resolveProtectedPageError(new Error('raw sdk stack'), 'manage');
  assert.equal(unknown.error, '申请列表加载失败，请稍后重试');
  assert.equal(JSON.stringify(unknown).includes('raw sdk'), false);
  assert.equal(unknown.errorAction, 'RETRY');
});

test('manage 与 group 缺失或畸形 ID 时结束 loading 并返回发现', async () => {
  const requests = [
    '../miniprogram/subpackages/activity/manage/index',
    '../miniprogram/subpackages/activity/group/index'
  ];
  for (const request of requests) {
    for (const options of [{}, { id: '%E0%A4%A' }]) {
      const { page, pagePath, tabSwitches } = loadPage(request);
      try {
        page.onLoad(options);
        await page.onShow();
        assert.equal(page.data.loading, false);
        assert.equal(page.data.errorCode, 'NOT_FOUND');
        assert.equal(page.data.errorAction, 'DISCOVER');
        page.handleErrorAction();
        assert.equal(tabSwitches[0].url, '/pages/discover/index');
      } finally {
        unloadPage(pagePath);
      }
    }
  }
});

test('group 丢弃页面卸载后才返回的旧详情响应', async () => {
  const originalDetail = activityService.detail;
  let resolveDetail;
  activityService.detail = () => new Promise((resolve) => { resolveDetail = resolve; });
  const { page, pagePath } = loadPage('../miniprogram/subpackages/activity/group/index');
  try {
    page.onLoad({ id: 'a_buddy' });
    const loading = page.onShow();
    page.onUnload();
    resolveDetail({
      activity: {
        id: 'a_buddy',
        type: 'buddy',
        title: '过期响应',
        city: '上海',
        district: '杨浦区',
        placeLabel: '五角场',
        startsAt: new Date().toISOString(),
        deadlineAt: new Date().toISOString(),
        targetMembers: 2,
        memberCount: 2,
        status: 'FORMED',
        owner: { nickname: '发起者' },
        typeData: { category: '运动', costMode: 'AA', level: 'BEGINNER' },
        viewerRole: 'member'
      }
    });
    await loading;
    assert.equal(page.data.activity, null);
  } finally {
    activityService.detail = originalDetail;
    unloadPage(pagePath);
  }
});

test('group 对成员可见但尚未成团的旧通知安全返回详情', async () => {
  const originalDetail = activityService.detail;
  activityService.detail = async () => ({
    activity: {
      id: 'a_ride',
      type: 'ride',
      title: '仍在招募的活动',
      city: '上海',
      district: '浦东新区',
      placeLabel: '张江',
      startsAt: new Date().toISOString(),
      deadlineAt: new Date().toISOString(),
      targetMembers: 3,
      memberCount: 2,
      status: 'RECRUITING',
      owner: { nickname: '发起者' },
      typeData: { origin: '张江', destination: '陆家嘴', feeType: 'SHARED_COST' },
      viewerRole: 'member'
    }
  });
  const { page, pagePath, redirects } = loadPage('../miniprogram/subpackages/activity/group/index');
  try {
    page.onLoad({ id: 'a_ride' });
    await page.onShow();
    assert.equal(page.data.loading, false);
    assert.equal(page.data.activity, null);
    assert.equal(page.data.errorCode, 'CONFLICT');
    assert.equal(page.data.errorAction, 'DETAIL');
    page.handleErrorAction();
    assert.equal(redirects[0].url, '/subpackages/activity/detail/index?id=a_ride');
  } finally {
    activityService.detail = originalDetail;
    unloadPage(pagePath);
  }
});

test('通知卡片标题在极窄屏允许 flex 收缩与连续字符折行', () => {
  const style = fs.readFileSync(path.join(root, 'miniprogram/pages/user/index.wxss'), 'utf8');
  assert.match(style, /\.task-main\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?word-break:\s*break-all;/);
});

test('目标页模板提供单页栈安全错误操作且不依赖 navigateBack', () => {
  ['manage', 'group'].forEach((name) => {
    const pageDir = path.join(root, `miniprogram/subpackages/activity/${name}`);
    const script = fs.readFileSync(path.join(pageDir, 'index.js'), 'utf8');
    const template = fs.readFileSync(path.join(pageDir, 'index.wxml'), 'utf8');
    assert.match(template, /bindaction="handleErrorAction"/);
    assert.match(template, /action-text="{{errorActionText}}"/);
    assert.match(script, /onUnload\(\)[\s\S]*_loadSeq/);
    assert.match(script, /loadSeq\s*!==\s*this\._loadSeq/);
    assert.doesNotMatch(script, /handleErrorAction[\s\S]{0,500}navigateBack/);
  });
});
