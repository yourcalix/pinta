'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { mergeMessages } = require('../miniprogram/utils/direct-message-view');

const message = (n) => ({ id: `m${String(n).padStart(3, '0')}`, text: `消息${n}`, isMine: false, createdAt: new Date(1700000000000 + n * 1000).toISOString() });
const conversation = (n = 1, available = true) => ({ id: 'c1', peer: { nickname: '阿同' }, source: { activityType: 'sport' }, messagingAvailable: available, lastMessage: { id: message(n).id } });

function harness(overrides = {}) {
  let definition;
  const timers = new Map();
  let timerId = 0;
  const reads = [];
  const sends = [];
  let hiddenKeyboard = 0;
  const service = {
    listMessages: async () => ({ conversation: conversation(), items: [message(1)], nextCursor: null }),
    markRead: async (id, last) => { reads.push(last); return { unread: 0 }; },
    sendMessage: async (id, key, text) => { sends.push({ key, text }); return { message: { ...message(2), isMine: true, text } }; },
    ...overrides
  };
  const source = fs.readFileSync(path.join(__dirname, '../miniprogram/subpackages/message/chat/index.js'), 'utf8');
  vm.runInNewContext(source, {
    Page(value) { definition = value; },
    require(name) {
      if (name.endsWith('/services/direct-message')) return service;
      if (name.endsWith('/utils/tab-bar')) return { refreshUnread: async () => 0 };
      if (name.endsWith('/utils/navigation-layout')) return { calculateContentTopInset: () => 88 };
      return require(path.join(__dirname, '../miniprogram/subpackages/message/chat', name));
    },
    wx: { hideKeyboard() { hiddenKeyboard += 1; } },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    Date, Math
  });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); } };
  page._visible = true;
  page._loadSeq = 1;
  page._isNearBottom = true;
  page.data.id = 'c1';
  page.data.loading = false;
  page.data.messagingAvailable = true;
  return { page, reads, sends, timers, service, keyboardCount: () => hiddenKeyboard };
}

test('消息合并保留30条历史并去重排序', () => {
  const result = mergeMessages(Array.from({ length: 30 }, (_, i) => message(i)), [message(31), message(29), message(30)]);
  assert.equal(result.length, 32);
  assert.equal(result[0].id, message(0).id);
  assert.equal(result[31].id, message(31).id);
});

test('同正文失败重试复用ID，编辑后使用新ID且发送成功不擦掉新草稿', async () => {
  const { page, service } = harness();
  const keys = [];
  service.sendMessage = async (id, key) => { keys.push(key); throw Object.assign(new Error('timeout'), { code: 'TIMEOUT' }); };
  page.handleInput({ detail: { value: '你好' } });
  await page.handleSend();
  await page.handleSend();
  assert.equal(keys[0], keys[1]);
  page.handleInput({ detail: { value: '新的正文' } });
  await page.handleSend();
  assert.notEqual(keys[1], keys[2]);
  service.sendMessage = async () => {
    page.handleInput({ detail: { value: '正在写下一条' } });
    return { message: { ...message(5), isMine: true } };
  };
  await page.handleSend();
  assert.equal(page.data.text, '正在写下一条');
});

test('轮询跨页追赶保留历史，阅读历史不跳底且不提前标记新消息', async () => {
  const { page, service, reads } = harness();
  page.data.messages = Array.from({ length: 31 }, (_, i) => message(i));
  page._isNearBottom = false;
  service.listMessages = async (id, cursor) => cursor
    ? { conversation: conversation(60), items: [message(30)], nextCursor: 'old' }
    : { conversation: conversation(60), items: Array.from({ length: 30 }, (_, i) => message(60 - i)), nextCursor: 'catchup' };
  await page.refreshLatest();
  assert.equal(page.data.messages.length, 61);
  assert.equal(page.data.scrollIntoView, '');
  assert.equal(reads.length, 0);
  page.handleScrollLower();
  await Promise.resolve();
  assert.equal(reads[0], message(60).id);
});

test('贴底收到新消息会滚动，隐藏后停止定时器并丢弃晚到响应', async () => {
  const { page, service, timers } = harness();
  page.data.messages = [message(0)];
  await page.refreshLatest();
  assert.equal(page.data.scrollIntoView, 'message-m001');
  page.schedulePolling();
  assert.equal([...timers.values()].some((item) => item.delay === 8000), true);
  let finish;
  service.listMessages = () => new Promise((resolve) => { finish = resolve; });
  const request = page.refreshLatest();
  page.onHide();
  finish({ conversation: conversation(2), items: [message(2)], nextCursor: null });
  await request;
  assert.equal(timers.size, 0);
  assert.equal(page.data.messages.some((item) => item.id === message(2).id), false);
});

test('权威只读状态主动收键盘；短暂轮询失败保留消息', async () => {
  const { page, service, keyboardCount } = harness();
  page.data.messages = [message(0)];
  service.listMessages = async () => { throw new Error('offline'); };
  await page.refreshLatest();
  assert.equal(page.data.messages.length, 1);
  assert.equal(page.data.error, '');
  service.listMessages = async () => ({ conversation: conversation(1, false), items: [message(1)], nextCursor: null });
  await page.refreshLatest();
  assert.equal(page.data.messagingAvailable, false);
  assert.equal(keyboardCount(), 1);
});

test('发送在隐藏期间落定不改页面，返回后同正文重试沿用原ID', async () => {
  const { page, service } = harness();
  let finish;
  const keys = [];
  service.sendMessage = (id, key) => { keys.push(key); return new Promise((resolve) => { finish = resolve; }); };
  page.handleInput({ detail: { value: '待确认消息' } });
  const request = page.handleSend();
  page.onHide();
  finish({ message: { ...message(3), isMine: true } });
  await request;
  assert.equal(page.data.messages.length, 0);
  assert.equal(page.data.text, '待确认消息');
  await page.onShow();
  service.sendMessage = async (id, key) => { keys.push(key); return { message: { ...message(3), isMine: true } }; };
  await page.handleSend();
  assert.equal(keys[0], keys[1]);
  assert.equal(page.data.messages.filter((item) => item.id === message(3).id).length, 1);
});

test('本地发送的新消息不截断下轮追赶边界，同步请求不重叠', async () => {
  const { page, service } = harness();
  await page.onShow();
  service.sendMessage = async () => ({ message: { ...message(50), isMine: true } });
  page.handleInput({ detail: { value: '我的消息' } });
  await page.handleSend();
  const calls = [];
  let finish;
  service.listMessages = (id, cursor) => {
    calls.push(cursor);
    return cursor ? Promise.resolve({ conversation: conversation(50), items: [message(2), message(1)], nextCursor: null })
      : new Promise((resolve) => { finish = resolve; });
  };
  const first = page.refreshLatest();
  await page.refreshLatest();
  assert.equal(calls.length, 1);
  finish({ conversation: conversation(50), items: [message(50)], nextCursor: 'catchup' });
  await first;
  assert.equal(calls.length, 2);
  assert.equal(page.data.messages.some((item) => item.id === message(2).id), true);
});

test('权限失效清除私信和输入，停止轮询且不显示底层错误', async () => {
  const { page, service, timers } = harness();
  await page.onShow();
  page.handleInput({ detail: { value: '未发正文' } });
  service.listMessages = async () => { throw Object.assign(new Error('internal storage detail'), { code: 'ACCOUNT_DISABLED' }); };
  await page.refreshLatest();
  assert.equal(page.data.messages.length, 0);
  assert.equal(page.data.conversation, null);
  assert.equal(page.data.text, '');
  assert.equal(page.data.messagingAvailable, false);
  assert.equal(page.data.error.includes('storage'), false);
  assert.equal(timers.size, 0);
});

test('旧已读在途时最新候选改变会补确认，网络失败不原地循环重试', async () => {
  const { page, service } = harness();
  const calls = [];
  let finish;
  page._latestReadCandidate = 'm001';
  service.markRead = (id, last) => {
    calls.push(last);
    return last === 'm001' ? new Promise((resolve) => { finish = resolve; }) : Promise.reject(new Error('offline'));
  };
  const first = page.markVisibleRead();
  page._latestReadCandidate = 'm002';
  await page.markVisibleRead();
  finish({ unread: 2 });
  await first;
  await Promise.resolve();
  assert.deepEqual(calls, ['m001', 'm002']);
});

test('发送发现权限失效后，在途列表成功回包不能重新恢复私信', async () => {
  const { page, service } = harness();
  let finish;
  service.listMessages = () => new Promise((resolve) => { finish = resolve; });
  const request = page.refreshLatest();
  page.handleAccessError({ code: 'ACCOUNT_DISABLED' });
  finish({ conversation: conversation(), items: [message(1)], nextCursor: null });
  await request;
  assert.equal(page.data.messages.length, 0);
  assert.equal(page.data.messagingAvailable, false);
});

test('同时间戳排序首项不等于最后提交消息时，只确认已实际拉取的会话最新ID', async () => {
  const { page, service, reads } = harness();
  const first = message(1);
  const second = { ...message(2), createdAt: first.createdAt };
  service.listMessages = async () => ({ conversation: conversation(1), items: [second, first], nextCursor: null });
  await page.refreshLatest();
  assert.equal(reads[0], first.id);
  service.listMessages = async () => ({ conversation: conversation(3), items: [second, first], nextCursor: null });
  await page.refreshLatest();
  assert.equal(reads.length, 1, '预览中的最新消息未拉取正文时不能确认');
});
