'use strict';

function createPrivacyBridge(platform) {
  let activePrompt = null;
  let listenerRegistered = false;

  function settleAsDisagree(resolve) {
    if (typeof resolve !== 'function') return;
    try {
      resolve({ event: 'disagree' });
    } catch (error) {
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('[pinba-privacy] failed to settle privacy request', error && error.message);
      }
    }
  }

  function ensureListener() {
    if (listenerRegistered) return true;
    if (!platform || typeof platform.onNeedPrivacyAuthorization !== 'function') return false;
    platform.onNeedPrivacyAuthorization((resolve, eventInfo) => {
      if (activePrompt && typeof activePrompt.handler === 'function') {
        try {
          activePrompt.handler({ resolve, eventInfo: eventInfo || {} });
          return;
        } catch (error) {
          if (typeof console !== 'undefined' && typeof console.warn === 'function') {
            console.warn('[pinba-privacy] privacy prompt handler failed', error && error.message);
          }
        }
      }
      settleAsDisagree(resolve);
    });
    listenerRegistered = true;
    return true;
  }

  function attachPrompt(handler) {
    if (typeof handler !== 'function') return () => {};
    const prompt = { handler };
    activePrompt = prompt;
    ensureListener();
    return () => {
      if (activePrompt === prompt) activePrompt = null;
    };
  }

  return {
    attachPrompt,
    clearPrompt() {
      activePrompt = null;
    },
    isSupported: ensureListener
  };
}

function clipboardFailureMessage(error) {
  const message = String(error && (error.errMsg || error.message) || '').toLowerCase();
  if (/privacy|not authorized|permission.*denied|errno[^0-9]*103/.test(message)) {
    return '未同意剪贴板权限，可长按上方联系信息手动复制';
  }
  return '复制失败，可长按上方联系信息手动复制';
}

let defaultBridge;

function getDefaultBridge() {
  if (!defaultBridge) {
    defaultBridge = createPrivacyBridge(typeof wx === 'undefined' ? null : wx);
  }
  return defaultBridge;
}

module.exports = {
  attachPrompt: (handler) => getDefaultBridge().attachPrompt(handler),
  clipboardFailureMessage,
  createPrivacyBridge,
  isSupported: () => getDefaultBridge().isSupported()
};
