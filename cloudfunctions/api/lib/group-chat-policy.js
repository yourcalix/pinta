'use strict';

const { invariant } = require('./errors');
const { stableEntityId } = require('./ids');
const { isCompleteRideProfile } = require('./passenger-avatar');

const WRITABLE = new Set(['RECRUITING', 'FORMED', 'IN_PROGRESS']);
const READABLE = new Set([...WRITABLE, 'COMPLETED', 'CANCELLED', 'EXPIRED']);
const sequenceValid = value => Number.isSafeInteger(value) && value >= 0;
const windowValid = window => Boolean(window && Number.isSafeInteger(window.generation)
  && window.generation > 0 && window.generation < Number.MAX_SAFE_INTEGER && sequenceValid(window.after));

// Store callers must run this inside the same transaction that makes a member
// ACTIVE. Read the activity sequence there; never accept it from the client.
// A missing sequence is NOT equivalent to a verified empty conversation.
function beginGroupMembership(activity, previousWindow = null) {
  invariant(activity && sequenceValid(activity.groupSequence)
    && activity.groupSequence < Number.MAX_SAFE_INTEGER, 'CONFLICT', '群聊序号尚未初始化或已失效');
  if (previousWindow !== null) {
    invariant(windowValid(previousWindow) && previousWindow.after <= activity.groupSequence
      && previousWindow.generation < Number.MAX_SAFE_INTEGER - 1, 'CONFLICT', '成员群聊周期已失效');
  }
  return {
    generation: previousWindow === null ? 1 : previousWindow.generation + 1,
    after: activity.groupSequence
  };
}

// This snapshot is internal only. Re-read these facts inside write transactions
// and after asynchronous history queries; never trust a cached/client snapshot.
function resolveGroupAccess({ activity, user, member, write = false }) {
  invariant(user && typeof user.id === 'string' && user.id, 'UNAUTHENTICATED');
  invariant(user.status === 'ACTIVE', 'ACCOUNT_DISABLED');
  invariant(isCompleteRideProfile(user.profile), 'PROFILE_INCOMPLETE');
  invariant(activity && typeof activity.id === 'string' && activity.id.trim(), 'NOT_FOUND');
  invariant(activity.status !== 'SUSPENDED', 'TAKEDOWN');
  invariant(READABLE.has(activity.status), 'FORBIDDEN');
  invariant(member && member.status === 'ACTIVE' && member.activityId === activity.id
    && member.userId === user.id && typeof member.id === 'string' && member.id, 'FORBIDDEN');
  invariant(sequenceValid(activity.groupSequence) && windowValid(member.groupWindow)
    && member.groupWindow.after <= activity.groupSequence, 'FORBIDDEN', '群聊访问范围尚未确认');
  const writable = WRITABLE.has(activity.status);
  invariant(!write || writable, 'CONFLICT', '活动已结束，群聊仅可查看');
  return {
    activityId: activity.id, actorId: user.id, memberId: member.id,
    generation: member.groupWindow.generation, after: member.groupWindow.after,
    latestSequence: activity.groupSequence, writable
  };
}

function isVisible(access, message) {
  return Boolean(message && message.activityId === access.activityId
    && sequenceValid(message.sequence) && message.sequence > access.after
    && message.sequence <= access.latestSequence);
}

// Apply to direct ID lookups, previews and idempotent replies as well as pages.
function assertGroupMessageVisible(access, message) {
  invariant(isVisible(access, message), 'FORBIDDEN');
  return message;
}

// Reference/in-memory pagination. Cloud queries must push the same sequence
// bounds into their query before limit; do not post-filter a truncated DB page.
function groupHistoryPage(access, messages, { before = null, limit = 20 } = {}) {
  invariant(before === null || sequenceValid(before), 'VALIDATION_ERROR', '分页游标无效');
  invariant(Number.isSafeInteger(limit) && limit > 0 && limit <= 100, 'VALIDATION_ERROR', '分页数量无效');
  const ordered = messages.filter(message => isVisible(access, message)
    && (before === null || message.sequence < before))
    .sort((a, b) => b.sequence - a.sequence);
  const items = ordered.slice(0, limit);
  return { items, nextBefore: ordered.length > limit ? items[items.length - 1].sequence : null };
}

// latestIncoming must be the latest visible message from somebody else. Passing
// the overall room preview is insufficient: a user's own send cannot mark
// previously unseen incoming messages as read.
function groupUnread(access, latestIncoming, readState) {
  if (!isVisible(access, latestIncoming) || latestIncoming.senderId === access.actorId) return false;
  const sameWindow = readState && readState.generation === access.generation
    && sequenceValid(readState.sequence) && readState.sequence >= access.after
    && readState.sequence <= access.latestSequence;
  const readThrough = sameWindow ? readState.sequence : access.after;
  return latestIncoming.sequence > readThrough;
}

function groupMessageId(access, requestedGeneration, clientMessageId) {
  invariant(requestedGeneration === access.generation, 'CONFLICT', '成员状态已变化，请重新进入群聊');
  invariant(typeof clientMessageId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(clientMessageId),
    'VALIDATION_ERROR', '客户端消息ID无效');
  return stableEntityId('groupMessage', access.activityId, access.actorId,
    access.memberId, access.generation, clientMessageId);
}

module.exports = {
  beginGroupMembership, resolveGroupAccess, assertGroupMessageVisible,
  groupHistoryPage, groupUnread, groupMessageId
};
