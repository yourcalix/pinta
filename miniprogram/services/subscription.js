'use strict';

const config = require('../config/index');

async function requestStatusUpdates() {
  if (config.useMock || !config.subscribeTemplateIds.length || !wx.requestSubscribeMessage) {
    return { skipped: true, reason: 'not-configured' };
  }
  try {
    const result = await wx.requestSubscribeMessage({ tmplIds: config.subscribeTemplateIds.slice(0, 3) });
    return { skipped: false, result };
  } catch (error) {
    return { skipped: true, reason: 'user-denied-or-unavailable' };
  }
}

module.exports = {
  requestStatusUpdates
};
