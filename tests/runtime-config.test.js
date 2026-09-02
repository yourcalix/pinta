'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { resolveRuntimeConfig } = require('../miniprogram/config/runtime-resolver');

const root = path.resolve(__dirname, '..');

test('运行配置默认保持 Mock 且只接受白名单本地覆盖', () => {
  const defaults = {
    useMock: true,
    cloudEnv: '',
    apiFunction: 'api',
    requestTimeoutMs: 8000,
    subscribeTemplateIds: [],
    demoCity: '澳门'
  };
  const resolved = resolveRuntimeConfig(defaults, {
    useMock: false,
    cloudEnv: 'synthetic-cloud-environment',
    apiFunction: 'api',
    unexpectedSecret: 'must-not-merge'
  });
  assert.equal(resolved.useMock, false);
  assert.equal(resolved.cloudEnv, 'synthetic-cloud-environment');
  assert.equal(resolved.unexpectedSecret, undefined);
  assert.equal(Object.isFrozen(resolved), true);
});

test('Node 测试环境不读取本机 local.js 且运行消费者统一使用 runtime 配置', () => {
  const runtimePath = require.resolve('../miniprogram/config/runtime');
  delete require.cache[runtimePath];
  const runtime = require(runtimePath);
  assert.equal(runtime.useMock, true);
  assert.equal(runtime.cloudEnv, '');

  [
    'miniprogram/app.js',
    'miniprogram/services/api.js',
    'miniprogram/services/subscription.js'
  ].forEach((relativePath) => {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.match(source, /config\/runtime/);
  });
});

test('无效本地覆盖 fail-closed', () => {
  assert.throws(
    () => resolveRuntimeConfig({
      useMock: true,
      cloudEnv: '',
      apiFunction: 'api',
      requestTimeoutMs: 8000,
      subscribeTemplateIds: []
    }, { useMock: 'false' }),
    /useMock 配置无效/
  );
});
