'use strict';

const config = require('./config/index');

App({
  globalData: {
    config,
    user: null
  },

  onLaunch() {
    if (!config.useMock && wx.cloud) {
      wx.cloud.init({
        env: config.cloudEnv || undefined,
        traceUser: true
      });
    }
  }
});
