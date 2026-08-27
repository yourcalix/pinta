'use strict';

const defaults = require('./index');
const { resolveRuntimeConfig } = require('./runtime-resolver');

function loadLocalConfig() {
  const isNodeRuntime = typeof process !== 'undefined' && process.versions && process.versions.node;
  if (isNodeRuntime || typeof wx === 'undefined') return {};
  try {
    return require('./local');
  } catch (error) {
    return {};
  }
}

module.exports = resolveRuntimeConfig(defaults, loadLocalConfig());
