'use strict';

const { AppError, invariant } = require('./errors');

const COMMUNITY_POST_STATUS = Object.freeze({ ACTIVE: 'ACTIVE', DELETED: 'DELETED', SUSPENDED: 'SUSPENDED' });
const COMMUNITY_REPLY_STATUS = Object.freeze({ ACTIVE: 'ACTIVE', DELETED: 'DELETED', SUSPENDED: 'SUSPENDED' });
const COMMUNITY_LIKE_STATUS = Object.freeze({ ACTIVE: 'ACTIVE', DELETED: 'DELETED' });
const COMMUNITY_LIKE_TARGETS = Object.freeze(['post', 'reply']);
const { stableEntityId } = require('./ids');

function communityLikeId(targetType, targetId, actorId) {
  return stableEntityId('communityLike', targetType, targetId, actorId);
}

function normalizeCommunityKeyword(value) {
  const text = String(value || '').trim();
  return (typeof text.normalize === 'function' ? text.normalize('NFKC') : text).toLowerCase();
}

function matchesCommunityKeyword(item, keyword) {
  const normalized = normalizeCommunityKeyword(keyword);
  return !normalized || normalizeCommunityKeyword(item && item.content).includes(normalized);
}

function encodeCursor(item, keyword = '') {
  if (!item) return null;
  const normalizedKeyword = normalizeCommunityKeyword(keyword);
  return Buffer.from(JSON.stringify({
    createdAt: item.createdAt,
    id: item.id,
    ...(normalizedKeyword ? { keyword: normalizedKeyword } : {})
  }), 'utf8').toString('base64url');
}

function decodeCursor(value, keyword = '') {
  if (value === undefined || value === null || value === '') return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    invariant(parsed && typeof parsed.createdAt === 'string' && Number.isFinite(Date.parse(parsed.createdAt)), 'VALIDATION_ERROR', '分页游标无效');
    invariant(typeof parsed.id === 'string' && parsed.id.length > 0 && parsed.id.length <= 80, 'VALIDATION_ERROR', '分页游标无效');
    invariant(normalizeCommunityKeyword(parsed.keyword) === normalizeCommunityKeyword(keyword), 'VALIDATION_ERROR', '分页游标与搜索条件不匹配');
    return parsed;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('VALIDATION_ERROR', '分页游标无效');
  }
}

function compareDescending(left, right) {
  const byTime = String(right.createdAt).localeCompare(String(left.createdAt));
  return byTime || String(right.id).localeCompare(String(left.id));
}

function compareAscending(left, right) {
  const byTime = String(left.createdAt).localeCompare(String(right.createdAt));
  return byTime || String(left.id).localeCompare(String(right.id));
}

function isAfterDescendingCursor(item, cursor) {
  return !cursor || item.createdAt < cursor.createdAt || (item.createdAt === cursor.createdAt && item.id < cursor.id);
}

function isAfterAscendingCursor(item, cursor) {
  return !cursor || item.createdAt > cursor.createdAt || (item.createdAt === cursor.createdAt && item.id > cursor.id);
}

function assertCommunityTextSafe(content) {
  const text = String(content || '');
  const compact = text.replace(/[\s._\-—:：·（）()]+/g, '');
  const forbidden = /(?:https?:\/\/|www\.|(?:weixin|wechat|微信|vx|v信|微讯|qq|群号)[A-Za-z0-9]{4,}|(?:\+?\d[\d\s()-]{6,}\d)|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i;
  invariant(!forbidden.test(text) && !forbidden.test(compact), 'VALIDATION_ERROR', '讨论区不支持外链或联系方式');
  return text;
}

module.exports = {
  COMMUNITY_POST_STATUS,
  COMMUNITY_REPLY_STATUS,
  COMMUNITY_LIKE_STATUS,
  COMMUNITY_LIKE_TARGETS,
  communityLikeId,
  normalizeCommunityKeyword,
  matchesCommunityKeyword,
  encodeCursor,
  decodeCursor,
  compareDescending,
  compareAscending,
  isAfterDescendingCursor,
  isAfterAscendingCursor,
  assertCommunityTextSafe
};
