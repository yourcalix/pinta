'use strict';

const DISCOVER_URL = '/pages/discover/index';
const MODAL_OPTIONS = Object.freeze({
  title: '账号暂时无法使用',
  content: '当前账号已被限制，暂时不能发布或参与活动。你仍可浏览公开活动。',
  showCancel: false,
  confirmText: '返回发现'
});

function createAccountDisabledFeedback(platform) {
  let activePrompt = null;

  function switchToDiscover() {
    return new Promise((resolve) => {
      if (!platform || typeof platform.switchTab !== 'function') {
        resolve();
        return;
      }
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      try {
        const result = platform.switchTab({
          url: DISCOVER_URL,
          success: settle,
          fail: settle,
          complete: settle
        });
        if (result && typeof result.then === 'function') result.then(settle, settle);
      } catch (error) {
        settle();
      }
    });
  }

  function present() {
    if (activePrompt) return activePrompt;

    const prompt = new Promise((resolve) => {
      let modalSettled = false;
      const redirect = () => {
        if (modalSettled) return;
        modalSettled = true;
        switchToDiscover().then(resolve, resolve);
      };

      if (!platform || typeof platform.showModal !== 'function') {
        redirect();
        return;
      }

      try {
        const result = platform.showModal({
          ...MODAL_OPTIONS,
          success: redirect,
          fail: redirect,
          complete: redirect
        });
        if (result && typeof result.then === 'function') result.then(redirect, redirect);
      } catch (error) {
        redirect();
      }
    });

    activePrompt = prompt.then(() => {
      activePrompt = null;
    });
    return activePrompt;
  }

  return { present };
}

let defaultFeedback;

function getDefaultFeedback() {
  if (!defaultFeedback) {
    defaultFeedback = createAccountDisabledFeedback(typeof wx === 'undefined' ? null : wx);
  }
  return defaultFeedback;
}

module.exports = {
  createAccountDisabledFeedback,
  present: () => getDefaultFeedback().present()
};
