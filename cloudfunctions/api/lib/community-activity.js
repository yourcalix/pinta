'use strict';

const { AppError, invariant } = require('./errors');
const { stableEntityId } = require('./ids');

const COMMUNITY_ACTIVITY_TYPES = Object.freeze({
  POST_REPLIED: 'POST_REPLIED',
  POST_LIKED: 'POST_LIKED',
  POST_STATUS: 'POST_STATUS'
});
const COMMUNITY_ACTIVITY_TABS = Object.freeze(['ALL', 'REPLIES', 'LIKES']);
const COMMUNITY_ACTIVITY_STATUS = Object.freeze({ ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' });

function communityReplyActivityId(replyId) {
  return stableEntityId('communityActivity', 'reply', replyId);
}

function communityLikeActivityId(recipientId, postId) {
  return stableEntityId('communityActivity', 'like', recipientId, postId);
}

function activityTypeForTab(tab) {
  if (tab === 'REPLIES') return COMMUNITY_ACTIVITY_TYPES.POST_REPLIED;
  if (tab === 'LIKES') return COMMUNITY_ACTIVITY_TYPES.POST_LIKED;
  return '';
}

function encodeCommunityActivityCursor(item, tab) {
  if (!item) return null;
  return Buffer.from(JSON.stringify({ updatedAt: item.updatedAt, id: item.id, tab }), 'utf8').toString('base64url');
}

function decodeCommunityActivityCursor(value, tab) {
  if (value === undefined || value === null || value === '') return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    invariant(parsed && typeof parsed.updatedAt === 'string' && Number.isFinite(Date.parse(parsed.updatedAt)), 'VALIDATION_ERROR', '动态分页游标无效');
    invariant(typeof parsed.id === 'string' && parsed.id.length > 0 && parsed.id.length <= 80, 'VALIDATION_ERROR', '动态分页游标无效');
    invariant(parsed.tab === tab, 'VALIDATION_ERROR', '动态分页游标与筛选条件不匹配');
    return parsed;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('VALIDATION_ERROR', '动态分页游标无效');
  }
}

function compareCommunityActivityDescending(left, right) {
  return String(right.updatedAt).localeCompare(String(left.updatedAt)) || String(right.id).localeCompare(String(left.id));
}

function isAfterCommunityActivityCursor(item, cursor) {
  return !cursor || item.updatedAt < cursor.updatedAt || (item.updatedAt === cursor.updatedAt && item.id < cursor.id);
}

module.exports = {
  COMMUNITY_ACTIVITY_TYPES,
  COMMUNITY_ACTIVITY_TABS,
  COMMUNITY_ACTIVITY_STATUS,
  communityReplyActivityId,
  communityLikeActivityId,
  activityTypeForTab,
  encodeCommunityActivityCursor,
  decodeCommunityActivityCursor,
  compareCommunityActivityDescending,
  isAfterCommunityActivityCursor
};
