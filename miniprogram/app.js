'use strict';

const config = require('./config/runtime');

App({
  globalData: {
    config,
    user: null,
    launchSplashShown: false
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
