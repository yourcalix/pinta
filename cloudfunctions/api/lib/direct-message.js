'use strict';

const { AppError, invariant } = require('./errors');

function encodeDirectCursor(item, timeField = 'createdAt') {
  if (!item) return null;
  return Buffer.from(JSON.stringify({
    at: item[timeField],
    id: item.id
  }), 'utf8').toString('base64url');
}

function decodeDirectCursor(value) {
  if (value === undefined || value === null || value === '') return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    invariant(parsed && typeof parsed.at === 'string' && Number.isFinite(Date.parse(parsed.at)), 'VALIDATION_ERROR', '分页游标无效');
    invariant(typeof parsed.id === 'string' && parsed.id.length > 0 && parsed.id.length <= 80, 'VALIDATION_ERROR', '分页游标无效');
    return parsed;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('VALIDATION_ERROR', '分页游标无效');
  }
}

function isAfterDirectCursor(item, cursor, timeField = 'createdAt') {
  const value = item && item[timeField];
  return !cursor || value < cursor.at || (value === cursor.at && item.id < cursor.id);
}

function compareDirectDescending(left, right, timeField = 'createdAt') {
  const byTime = String(right[timeField] || '').localeCompare(String(left[timeField] || ''));
  return byTime || String(right.id).localeCompare(String(left.id));
}

function assertDirectMessageTextSafe(content) {
  const text = String(content || '');
  const compact = text.replace(/[\s._\-—:：·（）()]+/g, '');
  const forbidden = /(?:https?:\/\/|www\.|(?:weixin|wechat|微信|vx|v信|微讯|qq|群号)[A-Za-z0-9]{4,}|(?:\+?\d[\d\s()-]{6,}\d)|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i;
  invariant(!forbidden.test(text) && !forbidden.test(compact), 'VALIDATION_ERROR', '私信暂不支持外链或联系方式');
  return text;
}

module.exports = {
  encodeDirectCursor,
  decodeDirectCursor,
  isAfterDirectCursor,
  compareDirectDescending,
  assertDirectMessageTextSafe
};
