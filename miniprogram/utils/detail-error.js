'use strict';

const SAFE_MESSAGES = Object.freeze({
  TAKEDOWN: '该活动已被平台处理，暂不可查看',
  TIMEOUT: '网络请求超时，请重试',
  NOT_FOUND: '活动不存在或已失效',
  INTERNAL: '服务暂时不可用，请稍后重试'
});

function resolveDetailError(error) {
  const errorCode = error && error.code ? String(error.code) : 'UNKNOWN';
  return {
    errorCode,
    error: SAFE_MESSAGES[errorCode] || '活动加载失败，请稍后重试'
  };
}

module.exports = {
  resolveDetailError
};
