'use strict';

const DISCOVER_PATH = '/pages/discover/index';
const TARGET_PATHS = Object.freeze({
  MANAGE: '/subpackages/activity/manage/index',
  GROUP: '/subpackages/activity/group/index',
  DETAIL: '/subpackages/activity/detail/index'
});

function decodeActivityId(value) {
  if (typeof value !== 'string' || !value) return '';
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return '';
  }
}

function buildActivityPath(target, activityId) {
  if (typeof activityId !== 'string' || !activityId) return DISCOVER_PATH;
  const page = TARGET_PATHS[target] || TARGET_PATHS.DETAIL;
  return `${page}?id=${encodeURIComponent(activityId)}`;
}

module.exports = {
  DISCOVER_PATH,
  decodeActivityId,
  buildActivityPath
};
