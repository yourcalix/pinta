'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');
const pageRoot = path.join(root, 'subpackages/community/compose');
const read = (filename) => fs.readFileSync(path.join(pageRoot, filename), 'utf8');

function loadPage() {
  const pagePath = require.resolve('../miniprogram/subpackages/community/compose/index');
  delete require.cache[pagePath];
  const previousPage = global.Page;
  const previousWx = global.wx;
  let definition;
  const toasts = [];
  global.Page = (value) => { definition = value; };
  global.wx = {
    showToast(options) { toasts.push(options); },
    navigateBack() {},
    showModal() {},
    getWindowInfo() { return { statusBarHeight: 20 }; },
    getMenuButtonBoundingClientRect() { return { top: 24, bottom: 56 }; }
  };
  require(pagePath);
  global.Page = previousPage;
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); }
  };
  return {
    page,
    toasts,
    restore() {
      global.wx = previousWx;
      delete require.cache[pagePath];
    }
  };
}

test('发布讨论页与发现页共用暖米白背景并采用参考式自定义导航和真实内容结构', () => {
  const template = read('index.wxml');
  const style = read('index.wxss');
  const config = JSON.parse(read('index.json'));
  assert.equal(config.navigationStyle, 'custom');
  assert.equal(config.backgroundColor, '#F9F7F2');
  assert.equal(config.backgroundColorTop, '#F9F7F2');
  assert.equal(config.backgroundColorBottom, '#F9F7F2');
  assert.equal(config.backgroundTextStyle, 'dark');
  assert.equal(config.navigationBarTextStyle, 'black');
  assert.doesNotMatch(template, /global-background-host|global-page-background|shared-paper-bg\.jpg/);
  assert.match(template, /class="compose-navigation"/);
  assert.match(template, /class="compose-cancel"[^>]*bindtap="handleCancel"/);
  assert.match(template, /class="compose-nav-title"[^>]*>发布讨论/);
  assert.match(template, /class="author-identity-card"/);
  assert.match(template, /\{\{authorNickname\}\}/);
  assert.match(template, /将公开展示在社区/);
  assert.match(template, /class="compose-editor-card"/);
  assert.match(template, /class="compose-counter"[^>]*>\{\{contentLength\}\}\/500/);
  assert.match(style, /page\s*\{[^}]*background:\s*#f9f7f2/s);
  assert.match(style, /\.compose-page\s*\{[^}]*background:\s*#f9f7f2/s);
  assert.match(style, /\.compose-navigation\s*\{[^}]*background:\s*rgba\(249, 247, 242, \.92\)/s);
  assert.match(style, /\.compose-cancel[\s\S]*color:\s*#374151/);
  assert.match(style, /\.compose-nav-title\s*\{[^}]*color:\s*#111827/s);
  assert.match(style, /\.compose-editor-card\s*\{[^}]*min-height:\s*440rpx/s);
  assert.match(style, /\.confirm-publish-button\s*\{[^}]*min-height:\s*96rpx/s);
});

test('发布讨论页保留500字、键盘避让、错误态和提交防重', () => {
  const template = read('index.wxml');
  const script = read('index.js');
  assert.match(template, /maxlength="500"/);
  assert.match(template, /cursor-spacing="140"/);
  assert.match(template, /adjust-position="true"/);
  assert.match(template, /wx:if="\{\{errorMessage\}\}"[^>]*role="alert"/);
  assert.match(template, /loading="\{\{submitting\}\}"/);
  assert.match(template, /disabled="\{\{submitting\}\}"/);
  assert.match(script, /if \(this\.data\.submitting\) return/);
  assert.match(script, /communityService\.createPost\(content\)/);
  assert.match(script, /wx\.redirectTo\(\{ url: `\/subpackages\/community\/detail\/index/);
  assert.doesNotMatch(script, /image|location|visibility|topicIds|categoryId/i);
});

test('话题胶囊只向正文插入受控标签并防重复与越界', () => {
  const template = read('index.wxml');
  const style = read('index.wxss');
  const script = read('index.js');
  ['寻找搭子', '运动打卡', '日常碎碎念'].forEach((topic) => {
    assert.match(template, new RegExp(`data-topic="#${topic}"[^>]*bindtap="handleTopicTap"`));
  });
  assert.match(style, /\.topic-capsules-row\s*\{[^}]*flex-wrap:\s*wrap/s);
  assert.match(style, /\.topic-capsule\s*\{[^}]*min-height:\s*88rpx/s);
  assert.match(style, /\.topic-capsule-visual\s*\{[^}]*min-height:\s*64rpx/s);
  assert.match(script, /TOPIC_TAGS/);
  assert.match(script, /已添加该话题/);
  assert.match(script, /字数已达上限/);

  const context = loadPage();
  try {
    context.page.handleTopicTap({ currentTarget: { dataset: { topic: '#寻找搭子' } } });
    assert.equal(context.page.data.content, '#寻找搭子 ');
    assert.equal(context.page.data.contentLength, 6);
    context.page.handleTopicTap({ currentTarget: { dataset: { topic: '#寻找搭子' } } });
    assert.equal(context.page.data.content, '#寻找搭子 ');
    assert.equal(context.toasts.at(-1).title, '已添加该话题');
    context.page.setData({ content: 'a'.repeat(495), contentLength: 495, remaining: 5 });
    context.page.handleTopicTap({ currentTarget: { dataset: { topic: '#运动打卡' } } });
    assert.equal(context.page.data.content.length, 495);
    assert.equal(context.toasts.at(-1).title, '字数已达上限');
  } finally {
    context.restore();
  }
});

test('作者徽章和社区守则使用分包本地透明PNG且守则为原生Modal', () => {
  const template = read('index.wxml');
  const script = read('index.js');
  const assets = [
    'assets/community-compose-author-badge.png',
    'assets/community-compose-rules-shield.png'
  ];
  assert.match(template, /\.\/assets\/community-compose-author-badge\.png/);
  assert.match(template, /class="author-badge-text"[^>]*>文/);
  assert.match(template, /\.\/assets\/community-compose-rules-shield\.png/);
  assert.match(template, /class="community-rules-card"[^>]*bindtap="handleGuidelines"/);
  assert.match(script, /wx\.showModal\(\{/);
  assert.match(script, /电话、微信号、二维码、外链/);
  assets.forEach((relativePath) => {
    const absolutePath = path.join(pageRoot, relativePath);
    assert.equal(fs.existsSync(absolutePath), true, relativePath);
    const bytes = fs.readFileSync(absolutePath);
    assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG');
    assert.ok(bytes.length < 30 * 1024, `${relativePath} is ${bytes.length} bytes`);
  });
});

test('发布讨论只读加载真实昵称且不为展示再次登录', () => {
  const script = read('index.js');
  assert.match(script, /userService\.getProfile\(\)/);
  assert.match(script, /result\s*&&\s*result\.user\s*&&\s*result\.user\.profile/);
  assert.doesNotMatch(script, /userService\.login\(\)/);
  assert.match(script, /calculateContentTopInset/);
  assert.match(script, /handleCancel\(\)[\s\S]*wx\.navigateBack\(\)/);
});

test('发布讨论页不修改全局Tab栏且子页面自身不伪造Tab栏', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const template = read('index.wxml');
  assert.deepEqual(app.tabBar.list.map((item) => item.text), ['首页', '发现', '发布', '消息', '我的']);
  assert.doesNotMatch(template, /custom-tab-bar|tab-bar|tabbar/i);
});
