'use strict';

const api = require('../../../services/api');

const STORAGE_KEY = 'leju_progress_state_v1';
const SNOOZE_DURATION_MS = 5 * 60 * 60 * 1000;
const MAX_RECORDS = 300;

function defaultPlatform() {
  return typeof wx === 'undefined' ? null : wx;
}

function stableDigest(value) {
  const input = String(value || '');
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    hashA = Math.imul(hashA ^ code, 0x01000193) >>> 0;
    hashB = Math.imul(hashB ^ code, 0x85ebca6b) >>> 0;
  }
  return `${hashA.toString(16).padStart(8, '0')}${hashB.toString(16).padStart(8, '0')}`;
}

function storageRecordKey(actorScope, activityId) {
  if (!actorScope || !activityId) return '';
  return stableDigest(`leju-progress:v1:${actorScope}:${activityId}`);
}

function readStore(platform) {
  if (!platform || typeof platform.getStorageSync !== 'function') return {};
  try {
    const stored = platform.getStorageSync(STORAGE_KEY);
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  } catch (error) {
    return {};
  }
}

function trimStore(store) {
  const entries = Object.entries(store);
  if (entries.length <= MAX_RECORDS) return store;
  const remove = entries
    .sort((left, right) => {
      const leftUpdatedAt = Number(left[1] && left[1].updatedAt);
      const rightUpdatedAt = Number(right[1] && right[1].updatedAt);
      const safeLeft = Number.isFinite(leftUpdatedAt) ? leftUpdatedAt : Number.NEGATIVE_INFINITY;
      const safeRight = Number.isFinite(rightUpdatedAt) ? rightUpdatedAt : Number.NEGATIVE_INFINITY;
      return safeLeft - safeRight;
    })
    .slice(0, entries.length - MAX_RECORDS);
  remove.forEach(([key]) => delete store[key]);
  return store;
}

function writeStore(platform, store) {
  if (!platform || typeof platform.setStorageSync !== 'function') return false;
  try {
    platform.setStorageSync(STORAGE_KEY, trimStore(store));
    return true;
  } catch (error) {
    return false;
  }
}

function context(options = {}) {
  return {
    platform: options.platform || defaultPlatform(),
    actorScope: options.actorScope === undefined ? api.getActorScope() : options.actorScope,
    now: Number.isFinite(options.now) ? options.now : Date.now()
  };
}

function recordFor(candidate, options = {}) {
  const current = context(options);
  const key = storageRecordKey(current.actorScope, candidate && candidate.activityId);
  if (!key || !candidate || !candidate.stage || !Number.isInteger(candidate.rank)) return { ...current, key: '', store: {}, record: null };
  const store = readStore(current.platform);
  const record = store[key] && typeof store[key] === 'object' ? store[key] : { highestSeenRank: -1, stages: {}, updatedAt: current.now };
  if (!record.stages || typeof record.stages !== 'object') record.stages = {};
  return { ...current, key, store, record };
}

function shouldPresent(candidate, options = {}) {
  const state = recordFor(candidate, options);
  if (!state.key || !state.record) return false;
  if (Number(state.record.highestSeenRank) >= candidate.rank) return false;
  const stage = state.record.stages[candidate.stage];
  if (stage && Number.isFinite(stage.seenAt)) return false;
  return !(stage && Number(stage.snoozeUntil) > state.now);
}

function updateCandidate(candidate, options, updater) {
  const state = recordFor(candidate, options);
  if (!state.key || !state.record) return false;
  updater(state.record, state.now);
  state.record.updatedAt = state.now;
  state.store[state.key] = state.record;
  return writeStore(state.platform, state.store);
}

function markSeen(candidate, options = {}) {
  return updateCandidate(candidate, options, (record, now) => {
    record.highestSeenRank = Math.max(Number(record.highestSeenRank) || 0, candidate.rank);
    record.stages[candidate.stage] = { seenAt: now, snoozeUntil: 0 };
  });
}

function snooze(candidate, options = {}) {
  return updateCandidate(candidate, options, (record, now) => {
    const current = record.stages[candidate.stage] || {};
    record.stages[candidate.stage] = {
      ...current,
      snoozeUntil: now + SNOOZE_DURATION_MS
    };
  });
}

module.exports = {
  STORAGE_KEY,
  SNOOZE_DURATION_MS,
  MAX_RECORDS,
  stableDigest,
  storageRecordKey,
  hasActorScope: () => Boolean(api.getActorScope()),
  shouldPresent,
  markSeen,
  snooze
};
