'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('自定义 TabBar 为首页、发现、发布、消息、我的五等分', () => {
  const app = JSON.parse(read('app.json'));
  assert.equal(app.tabBar.custom, true);
  assert.deepEqual(app.tabBar.list.map((item) => item.text), ['首页', '发现', '发布', '消息', '我的']);
  assert.equal(app.pages[3], 'pages/messages/index');
  assert.equal(app.subPackages.some((item) => item.root === 'subpackages/message' && item.pages.includes('chat/index')), true);

  const script = read('custom-tab-bar/index.js');
  const style = read('custom-tab-bar/index.wxss');
  assert.match(script, /wx\.switchTab/);
  assert.match(style, /flex:\s*1 1 20%/);
  assert.match(style, /width:\s*20%/);
  assert.match(style, /\.tab-shell\s*\{[\s\S]*left:\s*24rpx[\s\S]*height:\s*116rpx/);
  assert.match(style, /\.tab-paper\s*\{[^}]*background:\s*#fff[^}]*border-radius:\s*58rpx/s);
  assert.match(style, /\.publish-circle\s*\{[^}]*width:\s*92rpx[^}]*height:\s*92rpx[^}]*background:\s*#111827/s);
  assert.match(style, /env\(safe-area-inset-bottom\)/);
  assert.match(style, /\.unread-badge/);
});

test('普通入口使用单色 CSS 图标、激活黄点，发布入口使用黑色圆形加号', () => {
  const app = JSON.parse(read('app.json'));
  const template = read('custom-tab-bar/index.wxml');
  const script = read('custom-tab-bar/index.js');
  const style = read('custom-tab-bar/index.wxss');

  assert.match(template, /class="tab-icon tab-icon--\{\{item\.kind \|\| 'message'\}\}"/);
  assert.match(template, /class="publish-circle"[\s\S]*class="publish-plus"/);
  assert.match(template, /class="tab-selected-dot [^"]*"/);
  assert.match(template, /tab-selected-dot--hidden/);
  assert.doesNotMatch(script, /activeIcon/);
  assert.doesNotMatch(script, /iconPath|selectedIconPath/);
  assert.match(style, /\.tab-item--selected\s*\{[^}]*color:\s*#111827/s);
  assert.match(style, /\.tab-selected-dot\s*\{[^}]*margin-top:\s*4rpx[^}]*background:\s*#f59e0b/s);
  assert.doesNotMatch(style, /\.tab-selected-dot\s*\{[^}]*position:\s*absolute/s);
  assert.match(style, /\.publish-plus::before, \.publish-plus::after/);
  assert.deepEqual(app.tabBar.list.slice(0, 2).map((item) => item.pagePath), ['pages/discover/index', 'pages/community/index']);
});

test('五个 Tab 页在 onShow 同步选中态且页面为凸起按钮留出底部空间', () => {
  const pages = [
    ['pages/discover/index.js', 0, 'pages/discover/index.wxss'],
    ['pages/community/index.js', 1, 'pages/community/index.wxss'],
    ['pages/publish/index.js', 2, 'pages/publish/index.wxss'],
    ['pages/messages/index.js', 3, 'pages/messages/index.wxss'],
    ['pages/user/index.js', 4, 'pages/user/index.wxss']
  ];
  pages.forEach(([scriptPath, index, stylePath]) => {
    assert.match(read(scriptPath), new RegExp(`selectTab\\(this, ${index}\\)`));
    assert.match(read(stylePath), /padding-bottom:\s*calc\([^;]*safe-area-inset-bottom/);
  });
});

test('消息页区分系统通知与私信，聊天页具备键盘避让与举报入口', () => {
  const listTemplate = read('pages/messages/index.wxml');
  const listScript = read('pages/messages/index.js');
  const chatTemplate = read('subpackages/message/chat/index.wxml');
  const chatScript = read('subpackages/message/chat/index.js');
  const chatStyle = read('subpackages/message/chat/index.wxss');
  const chatConfig = JSON.parse(read('subpackages/message/chat/index.json'));
  assert.match(listTemplate, /系统通知/);
  assert.match(listTemplate, /全部私信/);
  assert.match(listScript, /Promise\.allSettled/);
  assert.match(listScript, /网络连接较慢或服务开小差了，请重试/);
  assert.doesNotMatch(listScript, /error\.message\s*\|\|\s*'消息加载/);
  assert.equal(chatConfig.navigationStyle, 'custom');
  assert.match(chatTemplate, /class="chat-navigation"/);
  assert.match(chatTemplate, /bindtap="handleBack"/);
  assert.match(chatTemplate, /class="source-strip"/);
  assert.match(chatTemplate, /bindtap="handleSource"/);
  assert.match(chatTemplate, /adjust-position="true"/);
  assert.match(chatTemplate, /cursor-spacing="24"/);
  assert.match(chatTemplate, /bindfocus="handleComposerFocus"/);
  assert.match(chatTemplate, /scroll-with-animation="\{\{scrollWithAnimation\}\}"/);
  assert.match(chatTemplate, /bindtap="handleReport"/);
  assert.match(chatScript, /type=directConversation/);
  assert.match(chatScript, /wx\.hideKeyboard/);
  assert.match(chatScript, /setTimeout\(\(\) => \{[\s\S]*scrollToLatest\(true\);[\s\S]*\}, 50\)/);
  assert.match(chatStyle, /word-break:\s*break-all/);
  assert.match(chatStyle, /overflow-wrap:\s*anywhere/);
  assert.match(chatStyle, /user-select:\s*text/);
});

test('私信空状态提供轻量破冰词且只读态不保留输入框', () => {
  const chatTemplate = read('subpackages/message/chat/index.wxml');
  const chatScript = read('subpackages/message/chat/index.js');
  assert.match(chatTemplate, /wx:for="\{\{quickPrompts\}\}"/);
  assert.match(chatTemplate, /bindtap="handleQuickPrompt"/);
  assert.match(chatTemplate, /\{\{closedText\}\}/);
  assert.match(chatScript, /历史私信仅供查看/);
  assert.match(chatScript, /当前活动已结束，这段咨询仅供查看/);
  assert.match(chatScript, /quickPrompts:/);
  assert.match(chatScript, /handleQuickPrompt/);
});

test('未读 Badge 只由未读摘要刷新，打开消息 Tab 不直接清零', () => {
  const tab = read('custom-tab-bar/index.js');
  const helper = read('utils/tab-bar.js');
  const messages = read('pages/messages/index.js');
  const chat = read('subpackages/message/chat/index.js');
  assert.doesNotMatch(tab, /markRead|dm\.conversation\.read/);
  assert.match(helper, /directMessageService\.unread\(\)/);
  assert.doesNotMatch(helper, /catch \(error\) \{\s*tabBar\.setUnread\(0\)/);
  assert.match(messages, /refreshUnread\(this\)/);
  assert.match(chat, /markRead\(this\.data\.id, lastMessageId\)/);
});
