'use strict';

const ALLOWED_KEYS = Object.freeze([
  'useMock',
  'cloudEnv',
  'apiFunction',
  'requestTimeoutMs',
  'subscribeTemplateIds',
  'demoCity'
]);

function resolveRuntimeConfig(defaults, local) {
  const base = defaults && typeof defaults === 'object' ? defaults : {};
  const overrides = local && typeof local === 'object' ? local : {};
  const resolved = { ...base };
  ALLOWED_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) resolved[key] = overrides[key];
  });
  if (typeof resolved.useMock !== 'boolean') throw new Error('useMock 配置无效');
  if (typeof resolved.cloudEnv !== 'string') throw new Error('cloudEnv 配置无效');
  if (typeof resolved.apiFunction !== 'string' || !resolved.apiFunction.trim()) throw new Error('apiFunction 配置无效');
  if (!Number.isFinite(resolved.requestTimeoutMs) || resolved.requestTimeoutMs <= 0) throw new Error('requestTimeoutMs 配置无效');
  if (!Array.isArray(resolved.subscribeTemplateIds)) throw new Error('subscribeTemplateIds 配置无效');
  return Object.freeze(resolved);
}

module.exports = { resolveRuntimeConfig };
