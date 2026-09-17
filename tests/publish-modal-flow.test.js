'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const activityService = require('../miniprogram/services/activity');
const subscriptionService = require('../miniprogram/services/subscription');

function loadPublishPage() {
  let definition;
  const storageWrites = [];
  const storageRemovals = [];
  const redirects = [];
  global.Page = (value) => { definition = value; };
  global.wx = {
    setStorageSync(key, value) { storageWrites.push({ key, value }); },
    removeStorageSync(key) { storageRemovals.push(key); },
    redirectTo(options) { redirects.push(options); },
    switchTab(options) { redirects.push(options); }
  };
  const pagePath = require.resolve('../miniprogram/subpackages/publish/form/index');
  delete require.cache[pagePath];
  require(pagePath);
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    draftKey: 'pinba_publish_draft_companion',
    _disposed: false,
    setData(patch) { Object.assign(this.data, patch); }
  };
  page.data.type = 'companion';
  page.data.submissionKey = 'publish-frozen-key';
  page.validateForm = () => '';
  page.buildPayload = () => ({ type: 'companion', title: '第一次提交', nested: { value: 1 } });
  return { page, pagePath, storageWrites, storageRemovals, redirects };
}

function unloadPublishPage(context) {
  delete require.cache[context.pagePath];
  delete global.Page;
  delete global.wx;
}

test('发布接口真实成功后才显示品牌弹窗且成功草稿不会复活', async () => {
  const originalCreate = activityService.create;
  const originalSubscribe = subscriptionService.requestStatusUpdates;
  const calls = [];
  activityService.create = async (payload, key) => { calls.push({ payload, key }); return { activity: { id: 'activity-success' } }; };
  subscriptionService.requestStatusUpdates = async () => ({ skipped: true });
  const context = loadPublishPage();
  try {
    await context.page.handleSubmit();
    assert.deepEqual(calls, [{ payload: { type: 'companion', title: '第一次提交', nested: { value: 1 } }, key: 'publish-frozen-key' }]);
    assert.deepEqual(context.storageRemovals, ['pinba_publish_draft_companion']);
    assert.equal(context.page.data.modal.type, 'success');
    assert.equal(context.page.data.modal.visible, true);
    assert.equal(context.redirects.length, 0);
    context.page.onHide();
    context.page.onUnload();
    assert.equal(context.storageWrites.length, 0);
  } finally {
    activityService.create = originalCreate;
    subscriptionService.requestStatusUpdates = originalSubscribe;
    unloadPublishPage(context);
  }
});

test('发布传输失败重试严格复用冻结 payload 与 key 且不重复订阅授权', async () => {
  const originalCreate = activityService.create;
  const originalSubscribe = subscriptionService.requestStatusUpdates;
  const calls = [];
  let subscriptions = 0;
  activityService.create = async (payload, key) => {
    calls.push({ payload: structuredClone(payload), key });
    if (calls.length === 1) {
      const error = new Error('网络请求超时，请重试');
      error.code = 'TIMEOUT';
      throw error;
    }
    return { activity: { id: 'activity-retried' } };
  };
  subscriptionService.requestStatusUpdates = async () => { subscriptions += 1; return { skipped: true }; };
  const context = loadPublishPage();
  try {
    await context.page.handleSubmit();
    assert.equal(context.page.data.modal.type, 'network');
    assert.equal(context.page.data.modal.visible, true);
    context.page.data.form.title = '用户后来改过的内容';
    context.page.buildPayload = () => ({ type: 'companion', title: '不应发送' });
    await context.page.handleModalConfirm();
    assert.equal(subscriptions, 1);
    assert.deepEqual(calls[1], calls[0]);
    assert.equal(context.page.data.modal.type, 'success');
    context.page.handleModalConfirm();
    assert.equal(context.page.data.modal.visible, false);
    context.page.handleModalClosed();
    assert.equal(context.redirects.length, 1);
    assert.equal(context.redirects[0].url, '/subpackages/activity/detail/index?id=activity-retried');
  } finally {
    activityService.create = originalCreate;
    subscriptionService.requestStatusUpdates = originalSubscribe;
    unloadPublishPage(context);
  }
});

test('发布业务错误保留原错误语义且不会冒充网络异常', async () => {
  const originalCreate = activityService.create;
  const originalSubscribe = subscriptionService.requestStatusUpdates;
  activityService.create = async () => {
    const error = new Error('活动时间不可用');
    error.code = 'VALIDATION_ERROR';
    throw error;
  };
  subscriptionService.requestStatusUpdates = async () => ({ skipped: true });
  const context = loadPublishPage();
  try {
    await context.page.handleSubmit();
    assert.equal(context.page.data.modal.visible, false);
    assert.equal(context.page.data.errorMessage, '活动时间不可用');
    assert.equal(context.storageWrites.length, 1);
  } finally {
    activityService.create = originalCreate;
    subscriptionService.requestStatusUpdates = originalSubscribe;
    unloadPublishPage(context);
  }
});

test('订阅消息 API 异常不会让发布按钮永久卡在 pending', async () => {
  const originalCreate = activityService.create;
  const originalSubscribe = subscriptionService.requestStatusUpdates;
  activityService.create = async () => ({ activity: { id: 'activity-after-subscribe-error' } });
  subscriptionService.requestStatusUpdates = async () => { throw new Error('subscribe unavailable'); };
  const context = loadPublishPage();
  try {
    await context.page.handleSubmit();
    assert.equal(context.page.data.submitting, false);
    assert.equal(context.page.data.modal.type, 'success');
    assert.equal(context.page.data.modal.visible, true);
  } finally {
    activityService.create = originalCreate;
    subscriptionService.requestStatusUpdates = originalSubscribe;
    unloadPublishPage(context);
  }
});
