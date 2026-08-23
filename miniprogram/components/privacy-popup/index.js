'use strict';

const privacyService = require('../../services/privacy');

Component({
  data: {
    visible: false
  },

  lifetimes: {
    attached() {
      this.detachPrivacyPrompt = privacyService.attachPrompt((request) => {
        this.handlePrivacyRequest(request);
      });
    },

    detached() {
      this.settlePrivacy({ event: 'disagree' }, false);
      if (this.detachPrivacyPrompt) this.detachPrivacyPrompt();
      this.detachPrivacyPrompt = null;
    }
  },

  methods: {
    handlePrivacyRequest(request) {
      if (!request || typeof request.resolve !== 'function') return;
      this.settlePrivacy({ event: 'disagree' }, false);
      this.resolvePrivacyAuthorization = request.resolve;
      this.setData({ visible: true });
      request.resolve({ event: 'exposureAuthorization' });
    },

    settlePrivacy(result, updateView = true) {
      const resolve = this.resolvePrivacyAuthorization;
      this.resolvePrivacyAuthorization = null;
      if (updateView) this.setData({ visible: false });
      if (typeof resolve === 'function') resolve(result);
    },

    handleAgreePrivacyAuthorization() {
      this.settlePrivacy({ buttonId: 'agree-btn', event: 'agree' });
    },

    handleRejectPrivacyAuthorization() {
      this.settlePrivacy({ event: 'disagree' });
    },

    handleOpenPrivacyContract() {
      if (typeof wx.openPrivacyContract !== 'function') {
        wx.showToast({ title: '当前微信版本暂不支持查看', icon: 'none' });
        return;
      }
      wx.openPrivacyContract({
        fail: () => wx.showToast({ title: '隐私指引暂时无法打开', icon: 'none' })
      });
    },

    preventTouchMove() {}
  }
});
