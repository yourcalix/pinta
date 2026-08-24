'use strict';

const { buildActivityPath } = require('../utils/activity-route');

const TARGET_LABELS = Object.freeze({
  MANAGE: '去处理',
  GROUP: '进入成团',
  DETAIL: '查看详情'
});

function normalizeTarget(target) {
  return Object.prototype.hasOwnProperty.call(TARGET_LABELS, target) ? target : 'DETAIL';
}

function decorateNotification(notification) {
  const target = normalizeTarget(notification && notification.target);
  return {
    ...(notification || {}),
    target,
    actionLabel: TARGET_LABELS[target]
  };
}

function resolveNotificationPath(notification) {
  if (!notification) return buildActivityPath('DETAIL', '');
  return buildActivityPath(normalizeTarget(notification.target), notification.activityId);
}

module.exports = {
  decorateNotification,
  resolveNotificationPath
};
