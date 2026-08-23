'use strict';

const ERROR_MESSAGES = Object.freeze({
  UNAUTHENTICATED: '请先登录后再操作',
  ACCOUNT_DISABLED: '账号已被限制，请联系平台处理',
  PROFILE_INCOMPLETE: '请先完成成年确认和基本资料',
  FORBIDDEN: '你没有权限执行此操作',
  VALIDATION_ERROR: '提交信息有误，请检查后重试',
  NOT_FOUND: '目标不存在或已失效',
  TAKEDOWN: '该活动已被平台处理，暂不可查看',
  CONFLICT: '当前状态已变化，请刷新后重试',
  CAPACITY_FULL: '名额已满，请选择其他活动',
  CONTENT_REJECTED: '内容未通过安全检查，请修改后重试',
  RATE_LIMITED: '操作过于频繁，请稍后重试',
  INTERNAL: '服务暂时不可用，请稍后重试'
});

class AppError extends Error {
  constructor(code, message, details) {
    super(message || ERROR_MESSAGES[code] || ERROR_MESSAGES.INTERNAL);
    this.name = 'AppError';
    this.code = code || 'INTERNAL';
    this.details = details;
  }
}

function invariant(condition, code, message, details) {
  if (!condition) {
    throw new AppError(code, message, details);
  }
}

function toPublicError(error) {
  if (error instanceof AppError) {
    const result = {
      code: error.code,
      message: error.message
    };
    if (error.details !== undefined) result.details = error.details;
    return result;
  }
  return {
    code: 'INTERNAL',
    message: ERROR_MESSAGES.INTERNAL
  };
}

module.exports = {
  AppError,
  ERROR_MESSAGES,
  invariant,
  toPublicError
};
