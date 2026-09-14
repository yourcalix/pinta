'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('消息主页按参考图展示三类入口与真实私信列表', () => {
  const template = read('pages/messages/index.wxml');
  const style = read('pages/messages/index.wxss');

  assert.match(template, /role="heading" aria-level="1">消息</);
  assert.doesNotMatch(template, /PINBA MESSAGES|和搭子保持联系|全部私信/);
  const script = read('pages/messages/index.js');
  assert.match(template, /wx:for="\{\{messageEntries\}\}"/);
  assert.match(script, /category: 'discussion'[\s\S]*讨论动态[\s\S]*有人回复了你的内容/);
  assert.match(script, /category: 'activity'[\s\S]*活动通知[\s\S]*拼团申请与成团消息/);
  assert.match(script, /category: 'system'[\s\S]*系统通知[\s\S]*官方信息与平台通知/);
  assert.match(script, /icon-discussion-bubble-3d\.png/);
  assert.match(script, /icon-activity-tent-3d\.png/);
  assert.match(script, /community-notification-bell\.png/);
  assert.match(template, /class="message-source-panel"/);
  assert.doesNotMatch(template, /source-thumbnail|原文图片/);
  assert.match(style, /background:\s*#f9f7f2/i);
  assert.match(style, /\.message-entry\s*\{[^}]*min-height:\s*140rpx/s);
  assert.match(style, /\.message-entry\s*\{[^}]*border-radius:\s*28rpx/s);
  assert.match(style, /\.message-source-panel\s*\{[^}]*background:\s*#faf8f4/s);
  assert.match(style, /@media\s*\(max-width:\s*340px\)/);
});

test('消息主页只把拼团事件归入活动通知并只把官方类型归入系统通知', () => {
  const previousPage = global.Page;
  global.Page = () => {};
  const modulePath = require.resolve('../miniprogram/pages/messages/index');
  delete require.cache[modulePath];
  const { classifyNotification } = require(modulePath);
  global.Page = previousPage;

  assert.equal(classifyNotification({ type: 'NEW_APPLICATION', activityId: 'activity-1' }), 'activity');
  assert.equal(classifyNotification({ type: 'GROUP_FORMED', activityId: 'activity-1' }), 'activity');
  assert.equal(classifyNotification({ type: 'SYSTEM_NOTICE' }), 'system');
  assert.equal(classifyNotification({ type: 'APPLICATION_APPROVED', activityId: 'activity-1' }), 'other');
  assert.equal(classifyNotification({ type: 'NEW_APPLICATION', activityId: '' }), 'other');
  assert.equal(classifyNotification({ type: 'ACCOUNT_WARNING' }), 'other');
});

test('消息主页入口和私信导航都有防重复入栈锁', () => {
  const script = read('pages/messages/index.js');
  assert.match(script, /handleMessageEntry/);
  assert.match(script, /_navigationPending/);
  assert.match(script, /subpackages\/community\/activity\/index/);
  assert.match(script, /subpackages\/activity\/list\/index/);
  assert.match(script, /subpackages\/message\/chat\/index/);
  assert.match(script, /_openSystemNotification[\s\S]*wx\.showModal/);
  assert.doesNotMatch(script, /systemNotification, '\/pages\/user\/index'/);
  assert.match(script, /Promise\.allSettled/);
});
