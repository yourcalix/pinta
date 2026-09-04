'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('真实私信接口缺失或网络失败不回退Mock；未知写结果保留重试键且不持久化正文', async () => {
  const module = { exports: {} };
  let mockCalls = 0;
  const sent = [];
  const stored = [];
  let response = async () => { throw new Error('network'); };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/services/api.js'), 'utf8'), {
    module, setTimeout, clearTimeout,
    require(name) {
      if (name.endsWith('/config/runtime')) return { useMock: false, apiFunction: 'api', requestTimeoutMs: 1000 };
      if (name.endsWith('/mocks/server')) return { call() { mockCalls++; }, getPersona: () => 'owner' };
      return { present() {} };
    },
    wx: {
      getStorageSync: () => ({}),
      setStorageSync(key, value) { stored.push(JSON.stringify(value)); },
      cloud: { callFunction(request) { sent.push(request.data); return response(); } }
    }
  });
  const api = module.exports;
  api.setActorScope('test-actor');
  const data = { conversationId: 'c1', clientMessageId: 'retry-message', text: '正文不可进入缓存' };
  await assert.rejects(api.invoke('dm.message.send', data));
  await assert.rejects(api.invoke('dm.message.send', data));
  assert.equal(sent[0].idempotencyKey, sent[1].idempotencyKey);
  response = async () => ({ result: { ok: false, error: { code: 'ACTION_NOT_FOUND', message: '接口动作不存在' } } });
  await assert.rejects(api.invoke('dm.conversations'), { code: 'ACTION_NOT_FOUND' });
  assert.equal(mockCalls, 0);
  assert.equal(stored.some((value) => value.includes(data.text)), false);
});
