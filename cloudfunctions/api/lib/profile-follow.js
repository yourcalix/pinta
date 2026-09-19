'use strict';

const { stableEntityId } = require('./ids');

const PROFILE_FOLLOW_LIST_TYPES = Object.freeze(['FOLLOWING', 'FOLLOWERS']);

function compareProfileFollowsDescending(left, right) {
  return String(right && right.updatedAt || '').localeCompare(String(left && left.updatedAt || ''))
    || String(right && right.id || '').localeCompare(String(left && left.id || ''));
}

function isAfterProfileFollowCursor(item, cursor) {
  return !cursor
    || item.updatedAt < cursor.updatedAt
    || item.updatedAt === cursor.updatedAt && item.id < cursor.id;
}

function profileFollowMemberKey(viewerId, type, memberId) {
  return stableEntityId('profileFollowMember', viewerId, type, memberId);
}

function profileFollowRelationId(followerId, targetUserId) {
  return stableEntityId('profileFollow', followerId, targetUserId);
}

module.exports = {
  PROFILE_FOLLOW_LIST_TYPES,
  compareProfileFollowsDescending,
  isAfterProfileFollowCursor,
  profileFollowMemberKey,
  profileFollowRelationId
};
