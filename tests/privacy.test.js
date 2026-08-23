'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('隐私监听桥接只注册一次并在无活动组件时明确拒绝', () => {
  const listeners = [];
  const platform = {
    onNeedPrivacyAuthorization(listener) {
      listeners.push(listener);
    }
  };
  const { createPrivacyBridge } = require('../miniprogram/services/privacy');
  const bridge = createPrivacyBridge(platform);
  const requests = [];
  const detach = bridge.attachPrompt((request) => requests.push(request));
  bridge.attachPrompt(() => {});

  assert.equal(listeners.length, 1);
  const resolutions = [];
  listeners[0]((value) => resolutions.push(value), { referrer: 'setClipboardData' });
  assert.equal(requests.length, 0, '后注册的活动组件应覆盖旧处理器');

  detach();
  bridge.clearPrompt();
  listeners[0]((value) => resolutions.push(value), { referrer: 'setClipboardData' });
  assert.deepEqual(resolutions.at(-1), { event: 'disagree' });
});

test('隐私监听桥接把请求交给当前活动组件', () => {
  let listener;
  const { createPrivacyBridge } = require('../miniprogram/services/privacy');
  const bridge = createPrivacyBridge({
    onNeedPrivacyAuthorization(callback) {
      listener = callback;
    }
  });
  let received;
  bridge.attachPrompt((request) => {
    received = request;
  });
  const resolve = () => {};
  listener(resolve, { referrer: 'setClipboardData' });
  assert.equal(received.resolve, resolve);
  assert.equal(received.eventInfo.referrer, 'setClipboardData');
});

test('隐私处理器抛错时仍以拒绝结算且非法 resolve 不会造成二次异常', () => {
  let listener;
  const { createPrivacyBridge } = require('../miniprogram/services/privacy');
  const bridge = createPrivacyBridge({
    onNeedPrivacyAuthorization(callback) {
      listener = callback;
    }
  });
  bridge.attachPrompt(() => {
    throw new Error('component detached');
  });

  const resolutions = [];
  listener((value) => resolutions.push(value), { referrer: 'setClipboardData' });
  assert.deepEqual(resolutions, [{ event: 'disagree' }]);
  assert.doesNotThrow(() => listener(null, { referrer: 'setClipboardData' }));
});

test('剪贴板失败文案区分隐私拒绝与普通失败', () => {
  const { clipboardFailureMessage } = require('../miniprogram/services/privacy');
  assert.match(
    clipboardFailureMessage({ errMsg: 'setClipboardData:fail privacy permission is not authorized' }),
    /未同意剪贴板权限/
  );
  assert.match(clipboardFailureMessage({ errMsg: 'setClipboardData:fail system error' }), /复制失败/);
});

test('隐私组件对曝光、同意、拒绝和销毁都结算微信回调', () => {
  const privacyService = require('../miniprogram/services/privacy');
  const originalAttachPrompt = privacyService.attachPrompt;
  let promptHandler;
  let detached = false;
  let definition;
  privacyService.attachPrompt = (handler) => {
    promptHandler = handler;
    return () => {
      detached = true;
    };
  };
  global.Component = (value) => {
    definition = value;
  };
  global.wx = {
    openPrivacyContract() {},
    showToast() {}
  };
  const componentPath = require.resolve('../miniprogram/components/privacy-popup/index');
  delete require.cache[componentPath];
  require(componentPath);

  const instance = {
    data: { ...definition.data },
    setData(value) {
      Object.assign(this.data, value);
    }
  };
  Object.assign(instance, definition.methods);
  definition.lifetimes.attached.call(instance);

  const resolved = [];
  promptHandler({
    resolve: (value) => resolved.push(value),
    eventInfo: { referrer: 'setClipboardData' }
  });
  assert.equal(instance.data.visible, true);
  assert.deepEqual(resolved[0], { event: 'exposureAuthorization' });
  instance.handleAgreePrivacyAuthorization();
  assert.equal(instance.data.visible, false);
  assert.deepEqual(resolved[1], { buttonId: 'agree-btn', event: 'agree' });

  promptHandler({ resolve: (value) => resolved.push(value), eventInfo: {} });
  instance.handleRejectPrivacyAuthorization();
  assert.deepEqual(resolved.at(-1), { event: 'disagree' });

  promptHandler({ resolve: (value) => resolved.push(value), eventInfo: {} });
  definition.lifetimes.detached.call(instance);
  assert.deepEqual(resolved.at(-1), { event: 'disagree' });
  assert.equal(detached, true);

  privacyService.attachPrompt = originalAttachPrompt;
  delete global.Component;
  delete global.wx;
  delete require.cache[componentPath];
});

test('成团页按需挂载隐私组件并提供可选中文本兜底', () => {
  const groupWxml = fs.readFileSync(path.join(root, 'miniprogram/subpackages/activity/group/index.wxml'), 'utf8');
  const groupJson = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/subpackages/activity/group/index.json'), 'utf8'));
  const popupWxml = fs.readFileSync(path.join(root, 'miniprogram/components/privacy-popup/index.wxml'), 'utf8');

  assert.equal(groupJson.usingComponents['privacy-popup'], '/components/privacy-popup/index');
  assert.match(groupWxml, /<privacy-popup[^>]*id="privacy-popup"/);
  assert.match(groupWxml, /<text[^>]*user-select="true"[^>]*class="contact-value"/);
  assert.match(popupWxml, /open-type="agreePrivacyAuthorization"/);
  assert.match(popupWxml, /id="agree-btn"/);

  const groupJs = fs.readFileSync(path.join(root, 'miniprogram/subpackages/activity/group/index.js'), 'utf8');
  assert.doesNotMatch(groupJs, /setClipboardData\([\s\S]*success:\s*\(\)\s*=>\s*wx\.showToast/);
  assert.match(groupJs, /fail:\s*\(error\)\s*=>\s*wx\.showToast/);
});

test('剪贴板 API 同步抛错时复制按钮恢复且给出降级提示', () => {
  let pageDefinition;
  const toasts = [];
  global.Page = (value) => {
    pageDefinition = value;
  };
  global.wx = {
    setClipboardData() {
      throw new Error('native bridge unavailable');
    },
    showToast(options) {
      toasts.push(options);
    }
  };
  const groupPath = require.resolve('../miniprogram/subpackages/activity/group/index');
  delete require.cache[groupPath];
  require(groupPath);

  const page = {
    ...pageDefinition,
    data: {
      ...pageDefinition.data,
      contact: { contactInfo: 'wxid_demo' },
      copying: false
    },
    setData(value) {
      Object.assign(this.data, value);
    }
  };
  assert.doesNotThrow(() => page.handleCopy());
  assert.equal(page.data.copying, false);
  assert.match(toasts.at(-1).title, /复制失败/);

  delete global.Page;
  delete global.wx;
  delete require.cache[groupPath];
});

test('仓库配置保持游客模式且为私有 AppID 提供忽略模板', () => {
  const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  const config = require('../miniprogram/config/index');
  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  const privateExample = JSON.parse(fs.readFileSync(path.join(root, 'project.private.config.example.json'), 'utf8'));

  assert.equal(project.appid, 'touristappid');
  assert.equal(config.useMock, true);
  assert.equal(config.cloudEnv, '');
  assert.deepEqual(config.subscribeTemplateIds, []);
  assert.match(gitignore, /^project\.private\.config\.json$/m);
  assert.equal(privateExample.appid, 'replace-with-your-wechat-appid');
});
