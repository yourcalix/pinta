'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('自定义 TabBar 为五等分，发布居中且消息位于我的之前', () => {
  const app = JSON.parse(read('app.json'));
  assert.equal(app.tabBar.custom, true);
  assert.deepEqual(app.tabBar.list.map((item) => item.text), ['发现', '社区', '发布', '消息', '我的']);
  assert.equal(app.pages[3], 'pages/messages/index');
  assert.equal(app.subPackages.some((item) => item.root === 'subpackages/message' && item.pages.includes('chat/index')), true);

  const script = read('custom-tab-bar/index.js');
  const style = read('custom-tab-bar/index.wxss');
  assert.match(script, /wx\.switchTab/);
  assert.match(style, /flex:\s*1 1 20%/);
  assert.match(style, /width:\s*20%/);
  assert.match(style, /\.publish-puzzle\s*\{[\s\S]*top:\s*-30rpx[\s\S]*width:\s*112rpx[\s\S]*height:\s*112rpx/);
  assert.match(style, /env\(safe-area-inset-bottom\)/);
  assert.match(style, /\.unread-badge/);
});

test('发布入口仅保留拼图图形，其余旧图标替换为单套油画棒透明资产', () => {
  const app = JSON.parse(read('app.json'));
  const template = read('custom-tab-bar/index.wxml');
  const script = read('custom-tab-bar/index.js');
  const style = read('custom-tab-bar/index.wxss');
  const assets = [
    'custom-tab-bar/assets/tab-discover-painted.png',
    'custom-tab-bar/assets/tab-community-painted.png',
    'custom-tab-bar/assets/tab-user-painted.png'
  ];

  assert.doesNotMatch(template, /publish-label|>发布<\/text>/);
  assert.match(template, /item\.publish \? '发布活动'/);
  assert.doesNotMatch(script, /activeIcon/);
  assert.doesNotMatch(script, /tab-(discover|community|user)-(inactive|active)\.png/);
  assert.match(style, /filter:\s*saturate\(0\.2\)/);
  assert.match(style, /\.tab-item--selected \.tab-icon\s*\{[\s\S]*scale\(1\.06\)/);

  assets.forEach((relativePath) => {
    const buffer = fs.readFileSync(path.join(root, relativePath));
    assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG');
    assert.equal(buffer.readUInt32BE(16), 128);
    assert.equal(buffer.readUInt32BE(20), 128);
    assert.equal(buffer[25], 6, `${relativePath} 必须保留 RGBA 透明通道`);
    assert.ok(buffer.length < 40 * 1024, `${relativePath} 必须小于微信 TabBar 图标 40KB 上限`);
  });

  const ordinaryItems = [app.tabBar.list[0], app.tabBar.list[1], app.tabBar.list[4]];
  assert.deepEqual(ordinaryItems.map((item) => item.iconPath), assets);
  ordinaryItems.forEach((item) => assert.equal(item.iconPath, item.selectedIconPath));
});

test('中央发布资产为真实透明 RGBA PNG 且有足够清晰度', () => {
  const asset = path.join(root, 'custom-tab-bar/assets/tab-publish-puzzle.png');
  const buffer = fs.readFileSync(asset);
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(buffer.readUInt32BE(16), 224);
  assert.equal(buffer.readUInt32BE(20), 224);
  assert.equal(buffer[25], 6, 'PNG 必须为 RGBA 透明色类型');
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
  assert.match(listTemplate, /系统通知/);
  assert.match(listTemplate, /全部私信/);
  assert.match(listScript, /Promise\.allSettled/);
  assert.match(listScript, /网络连接较慢或服务开小差了，请重试/);
  assert.doesNotMatch(listScript, /error\.message\s*\|\|\s*'消息加载/);
  assert.match(chatTemplate, /adjust-position="true"/);
  assert.match(chatTemplate, /cursor-spacing="20"/);
  assert.match(chatTemplate, /bindtap="handleReport"/);
  assert.match(chatScript, /type=directConversation/);
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
