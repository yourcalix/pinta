'use strict';

const TARGETS = Object.freeze({
  MANAGE: 'MANAGE',
  GROUP: 'GROUP',
  DETAIL: 'DETAIL'
});

const TYPE_TARGETS = Object.freeze({
  NEW_APPLICATION: TARGETS.MANAGE,
  GROUP_FORMED: TARGETS.GROUP
});

const TARGET_PAGES = Object.freeze({
  MANAGE: 'subpackages/activity/manage/index',
  GROUP: 'subpackages/activity/group/index',
  DETAIL: 'subpackages/activity/detail/index'
});

function resolveNotificationTarget(type) {
  return TYPE_TARGETS[type] || TARGETS.DETAIL;
}

function buildNotificationPage(type, activityId) {
  if (typeof activityId !== 'string' || !activityId) return 'pages/discover/index';
  const target = resolveNotificationTarget(type);
  return `${TARGET_PAGES[target]}?id=${encodeURIComponent(activityId)}`;
}

module.exports = {
  TARGETS,
  resolveNotificationTarget,
  buildNotificationPage
};
