'use strict';

const defaults = require('./index');
const { isMiniProgramHost, resolveRuntimeConfig } = require('./runtime-resolver');

function loadLocalConfig() {
  const host = typeof wx === 'undefined' ? null : wx;
  if (!isMiniProgramHost(host)) return {};
  try {
    return require('./local');
  } catch (error) {
    const missingLocalConfig = error
      && error.code === 'MODULE_NOT_FOUND'
      && /['"]\.\/local['"]/.test(String(error.message || ''));
    if (missingLocalConfig) return {};
    throw error;
  }
}

module.exports = resolveRuntimeConfig(defaults, loadLocalConfig());
