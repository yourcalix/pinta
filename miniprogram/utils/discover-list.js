'use strict';

const MIN_EXPIRATION_DELAY_MS = 1000;
const MAX_EXPIRATION_DELAY_MS = 60 * 60 * 1000;

function mergeActivitiesById(currentItems, incomingItems) {
  const incomingById = new Map((incomingItems || []).map((item) => [item.id, item]));
  const merged = (currentItems || []).map((item) => incomingById.get(item.id) || item);
  const existingIds = new Set(merged.map((item) => item.id));
  for (const item of incomingItems || []) {
    if (!existingIds.has(item.id)) {
      merged.push(item);
      existingIds.add(item.id);
    }
  }
  return merged;
}

function expirationSchedule(items, now = Date.now()) {
  const deadlines = (items || [])
    .filter((item) => item.status === 'RECRUITING')
    .map((item) => Date.parse(item.deadlineAt))
    .filter(Number.isFinite);
  if (!deadlines.length) return null;
  const deadlineAt = Math.min(...deadlines);
  const delay = Math.max(
    MIN_EXPIRATION_DELAY_MS,
    Math.min(deadlineAt - now, MAX_EXPIRATION_DELAY_MS)
  );
  return { deadlineAt, delay };
}

function removeLocallyExpiredRecruiting(items, now = Date.now()) {
  return (items || []).filter((item) => (
    item.status !== 'RECRUITING'
    || !Number.isFinite(Date.parse(item.deadlineAt))
    || Date.parse(item.deadlineAt) > now
  ));
}

module.exports = {
  MIN_EXPIRATION_DELAY_MS,
  MAX_EXPIRATION_DELAY_MS,
  mergeActivitiesById,
  expirationSchedule,
  removeLocallyExpiredRecruiting
};
