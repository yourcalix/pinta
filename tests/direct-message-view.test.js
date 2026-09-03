'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decorateMessageList, GROUP_WINDOW_MS } = require('../miniprogram/utils/direct-message-view');

test('三分钟内同一发送者的连续私信折叠头像与时间', () => {
  const items = decorateMessageList([
    { id: 'first', isMine: false, text: '第一条', createdAt: '2026-09-03T10:00:00.000Z' },
    { id: 'second', isMine: false, text: '第二条', createdAt: '2026-09-03T10:02:59.000Z' },
    { id: 'third', isMine: false, text: '第三条', createdAt: new Date(Date.parse('2026-09-03T10:02:59.000Z') + GROUP_WINDOW_MS).toISOString() }
  ], '小满');

  assert.equal(items[0].showTime, true);
  assert.equal(items[0].showPeerAvatar, true);
  assert.equal(items[1].showTime, false);
  assert.equal(items[1].showPeerAvatar, false);
  assert.equal(items[1].compact, true);
  assert.equal(items[2].showTime, true);
  assert.equal(items[2].showPeerAvatar, true);
});

test('发送者变化会开启新消息组并生成稳定无障碍文本', () => {
  const items = decorateMessageList([
    { id: 'peer:1', isMine: false, text: '你好', createdAt: '2026-09-03T10:00:00.000Z' },
    { id: 'mine/2', isMine: true, text: '你好呀', createdAt: '2026-09-03T10:00:30.000Z' }
  ], '小满');

  assert.equal(items[1].showTime, true);
  assert.equal(items[1].showPeerAvatar, false);
  assert.match(items[0].accessibilityLabel, /小满发送的消息：你好/);
  assert.match(items[1].accessibilityLabel, /我发送的消息：你好呀/);
  assert.equal(items[0].anchorId, 'message-peer-1');
  assert.equal(items[1].anchorId, 'message-mine-2');
});
