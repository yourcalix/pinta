'use strict';

const PAGE_MESSAGES = Object.freeze({
  manage: {
    FORBIDDEN: '仅发起者可管理申请',
    UNKNOWN: '申请列表加载失败，请稍后重试'
  },
  group: {
    FORBIDDEN: '仅活动成员可查看成团信息',
    UNKNOWN: '成团信息加载失败，请稍后重试'
  }
});

function result(errorCode, error, errorAction, errorActionText) {
  return { errorCode, error, errorAction, errorActionText };
}

function resolveProtectedPageError(error, pageKind) {
  const messages = PAGE_MESSAGES[pageKind] || PAGE_MESSAGES.group;
  const errorCode = error && error.code ? String(error.code) : 'UNKNOWN';

  if (errorCode === 'ACCOUNT_DISABLED' || (error && error.handled)) {
    return result('ACCOUNT_DISABLED', '账号暂时无法使用', '', '');
  }
  if (errorCode === 'NOT_FOUND') {
    return result(errorCode, '活动不存在或已失效', 'DISCOVER', '返回发现页');
  }
  if (errorCode === 'TAKEDOWN') {
    return result(errorCode, '该活动已被平台处理，暂不可查看', 'DISCOVER', '返回发现页');
  }
  if (errorCode === 'FORBIDDEN') {
    return result(errorCode, messages.FORBIDDEN, 'DETAIL', '查看活动详情');
  }
  if (errorCode === 'UNAUTHENTICATED') {
    return result(errorCode, '请先登录后再操作', 'DETAIL', '查看活动详情');
  }
  if (errorCode === 'CONFLICT') {
    return result(errorCode, '活动当前状态不支持此操作', 'DETAIL', '查看活动详情');
  }
  if (errorCode === 'TIMEOUT') {
    return result(errorCode, '网络请求超时，请重试', 'RETRY', '重新加载');
  }
  return result(errorCode, messages.UNKNOWN, 'RETRY', '重新加载');
}

module.exports = {
  resolveProtectedPageError
};
