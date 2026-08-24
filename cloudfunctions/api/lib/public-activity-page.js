'use strict';

const { AppError } = require('./errors');
const { ACTIVITY_STATUS } = require('./constants');

const MAX_BATCH_SIZE = 50;
const MAX_SCAN_SIZE = 500;

function parsePublicCursor(value) {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value >= 0) return value;
    throw new AppError('VALIDATION_ERROR', '分页游标无效', { field: 'cursor' });
  }
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new AppError('VALIDATION_ERROR', '分页游标无效', { field: 'cursor' });
  }
  const cursor = Number(value);
  if (!Number.isSafeInteger(cursor)) {
    throw new AppError('VALIDATION_ERROR', '分页游标无效', { field: 'cursor' });
  }
  return cursor;
}

function normalizeActivityForRead(activity, at) {
  if (!activity || activity.status !== ACTIVITY_STATUS.RECRUITING) return activity;
  const now = Date.parse(at);
  const deadline = Date.parse(activity.deadlineAt);
  if (!Number.isFinite(now) || !Number.isFinite(deadline) || deadline > now) return activity;
  return { ...activity, status: ACTIVITY_STATUS.EXPIRED };
}

function isPublicListActivity(activity) {
  return activity && [ACTIVITY_STATUS.RECRUITING, ACTIVITY_STATUS.FORMED].includes(activity.status);
}

function matchesKeyword(activity, keyword) {
  if (!keyword) return true;
  const normalized = String(keyword).toLowerCase();
  return `${activity.title || ''} ${activity.description || ''}`.toLowerCase().includes(normalized);
}

async function collectPublicActivityPage(options) {
  const {
    offset = 0,
    limit = 20,
    keyword = '',
    at,
    fetchBatch,
    maxScan = MAX_SCAN_SIZE
  } = options || {};
  if (typeof fetchBatch !== 'function') throw new AppError('INTERNAL', '公开列表数据源未配置');

  const items = [];
  const batchSize = Math.min(MAX_BATCH_SIZE, Math.max(20, limit + 1));
  let rawOffset = offset;
  let scanned = 0;
  let exhausted = false;

  while (items.length <= limit && scanned < maxScan && !exhausted) {
    const requestSize = Math.min(batchSize, maxScan - scanned);
    const batch = await fetchBatch(rawOffset, requestSize);
    if (!Array.isArray(batch) || batch.length === 0) {
      exhausted = true;
      break;
    }

    let processed = 0;
    for (const storedActivity of batch) {
      const candidateOffset = rawOffset;
      rawOffset += 1;
      scanned += 1;
      processed += 1;
      const activity = normalizeActivityForRead(storedActivity, at);
      if (isPublicListActivity(activity) && matchesKeyword(activity, keyword)) {
        if (items.length === limit) {
          return { items, nextCursor: String(candidateOffset) };
        }
        items.push(activity);
      }
      if (scanned >= maxScan) break;
    }

    if (processed === batch.length && batch.length < requestSize) exhausted = true;
  }

  return {
    items,
    nextCursor: exhausted ? null : String(rawOffset)
  };
}

module.exports = {
  MAX_SCAN_SIZE,
  parsePublicCursor,
  normalizeActivityForRead,
  collectPublicActivityPage
};
