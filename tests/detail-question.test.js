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
    showToast() {},
    navigateTo() {},
    switchTab() {},
    showModal() {}
  };
  const pagePath = require.resolve('../miniprogram/subpackages/activity/detail/index');
  delete require.cache[pagePath];
  require(pagePath);
  return {
    pagePath,
    page: {
      ...definition,
      data: JSON.parse(JSON.stringify(definition.data)),
      setData(value) { Object.assign(this.data, value); }
    }
  };
}

function unloadDetailPage(context) {
  delete require.cache[context.pagePath];
  delete global.Page;
  delete global.wx;
}

function qaItem(id, overrides = {}) {
  return {
    id,
    activityId: 'activity-qa',
    content: `问题 ${id}`,
    asker: { nickname: '提问者' },
    answer: null,
    createdAt: '2026-08-24T09:00:00.000Z',
    updatedAt: '2026-08-24T09:00:00.000Z',
    ...overrides
  };
}

test('问答列表使用独立序列号丢弃晚到响应且局部错误不清空活动', async () => {
  const originalList = activityService.qaList;
  let resolveFirst;
  let calls = 0;
  activityService.qaList = () => {
    calls += 1;
    if (calls === 1) return new Promise((resolve) => { resolveFirst = resolve; });
    return Promise.resolve({ items: [qaItem('new')], nextCursor: null });
  };
  const context = loadDetailPage();
  const activity = { id: 'activity-qa', status: 'RECRUITING', viewerRole: 'guest' };
  context.page.setData({ id: 'activity-qa', activity });

  try {
    const first = context.page.loadQuestions(activity);
    await context.page.loadQuestions(activity);
    resolveFirst({ items: [qaItem('stale')], nextCursor: null });
    await first;
    assert.deepEqual(context.page.data.qa.items.map((item) => item.id), ['new']);
    assert.equal(context.page.data.activity.id, 'activity-qa');

    activityService.qaList = async () => { throw new Error('raw sdk error'); };
    await context.page.loadQuestions(activity);
    assert.equal(context.page.data.qa.error, '公开问答暂时无法加载');
    assert.equal(context.page.data.activity.id, 'activity-qa');
    assert.equal(JSON.stringify(context.page.data.qa).includes('raw sdk'), false);
  } finally {
    activityService.qaList = originalList;
    unloadDetailPage(context);
  }
});

test('问答提交失败保留输入、恢复 pending 且不叠加 handled 错误 Toast', async () => {
  const originalAsk = activityService.askQuestion;
  const originalLogin = userService.login;
  const toasts = [];
  const context = loadDetailPage();
  global.wx.showToast = (options) => { toasts.push(options); };
  userService.login = async () => ({ profile: null });
  activityService.askQuestion = async () => {
    const error = new Error('账号受限');
    error.code = 'ACCOUNT_DISABLED';
    error.handled = true;
    throw error;
  };
  context.page.setData({
    id: 'activity-qa',
    activity: { id: 'activity-qa', status: 'RECRUITING', viewerRole: 'guest' },
    qaModal: {
      visible: true,
      type: 'ask',
      targetId: '',
      targetContent: '',
      content: '请问可以带行李吗？',
      submitting: false
    }
  });

  try {
    await context.page.handleSubmitQuestion();
    assert.equal(context.page.data.qaModal.visible, true);
    assert.equal(context.page.data.qaModal.content, '请问可以带行李吗？');
    assert.equal(context.page.data.qaModal.submitting, false);
    assert.equal(toasts.length, 0);
  } finally {
    activityService.askQuestion = originalAsk;
    userService.login = originalLogin;
    unloadDetailPage(context);
  }
});

test('详情页问答区具备完整事件绑定、局部状态、输入抽屉和无障碍热区', () => {
  const pageDir = path.join(root, 'miniprogram/subpackages/activity/detail');
  const script = fs.readFileSync(path.join(pageDir, 'index.js'), 'utf8');
  const template = fs.readFileSync(path.join(pageDir, 'index.wxml'), 'utf8');
  const style = fs.readFileSync(path.join(pageDir, 'index.wxss'), 'utf8');

  assert.match(script, /_qaLoadSeq/);
  assert.match(script, /loadQuestions/);
  assert.match(script, /error\.handled/);
  assert.match(template, /公开问答/);
  assert.match(template, /bindtap="handleOpenAsk"/);
  assert.match(template, /bindtap="handleOpenAnswer"/);
  assert.match(template, /bindtap="handleRetryQuestions"/);
  assert.match(template, /bindinput="handleQuestionInput"/);
  assert.match(template, /bindtap="handleSubmitQuestion"/);
  assert.match(template, /cursor-spacing="140"/);
  assert.match(template, /adjust-position="true"/);
  assert.match(template, /class="qa-modal"[^>]*catchtouchmove="preventTouchMove"/);
  assert.doesNotMatch(template, /<scroll-view[^>]*class="[^"]*qa/);
  assert.match(style, /\.qa-action[\s\S]*min-height:\s*88rpx/);
  assert.match(style, /\.qa-sheet[\s\S]*safe-area-inset-bottom/);
  assert.match(style, /word-break:\s*break-all/);
});
