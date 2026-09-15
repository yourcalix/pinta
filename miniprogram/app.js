'use strict';

const config = require('./config/runtime');
const appPresence = require('./services/app-presence');

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
  },

  onShow() {
    appPresence.show();
  },

  onHide() {
    appPresence.hide();
  }
});
