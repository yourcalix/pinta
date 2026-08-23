'use strict';

const config = require('../config/index');
const mockServer = require('../mocks/server');

const MUTATING_ACTIONS = new Set([
  'profile.update',
  'activity.create',
  'activity.cancel',
  'activity.complete',
  'application.submit',
  'application.approve',
  'application.reject',
  'application.withdraw',
  'member.leave',
  'notification.read',
  'report.create',
  'admin.activity.suspend'
]);
const PENDING_MUTATIONS_STORAGE_KEY = 'pinba_pending_mutations_v1';
const PENDING_MUTATION_TTL_MS = 15 * 60 * 1000;
const MAX_PENDING_MUTATIONS = 100;
let authenticatedActorScope = '';

function readPendingMutations() {
  try {
    if (typeof wx === 'undefined') return {};
    const stored = wx.getStorageSync(PENDING_MUTATIONS_STORAGE_KEY);
    return stored && typeof stored === 'object' ? stored : {};
  } catch (error) {
    return {};
  }
}

const pendingMutationKeys = new Map(
  Object.entries(readPendingMutations())
    .filter(([, entry]) => entry && entry.key && Date.now() - Number(entry.createdAt) < PENDING_MUTATION_TTL_MS)
    .map(([fingerprint, entry]) => [fingerprint, entry])
);

function persistPendingMutations() {
  try {
    if (typeof wx === 'undefined') return;
    wx.setStorageSync(PENDING_MUTATIONS_STORAGE_KEY, Object.fromEntries(pendingMutationKeys));
  } catch (error) {
    // Storage failure only reduces retry durability; the in-memory key still works.
  }
}

function sweepPendingMutations() {
  const now = Date.now();
  let changed = false;
  for (const [fingerprint, entry] of pendingMutationKeys) {
    if (!entry || !entry.key || now - Number(entry.createdAt) >= PENDING_MUTATION_TTL_MS) {
      pendingMutationKeys.delete(fingerprint);
      changed = true;
    }
  }
  if (pendingMutationKeys.size > MAX_PENDING_MUTATIONS) {
    const overflow = [...pendingMutationKeys.entries()]
      .sort((left, right) => Number(left[1].createdAt) - Number(right[1].createdAt))
      .slice(0, pendingMutationKeys.size - MAX_PENDING_MUTATIONS);
    overflow.forEach(([fingerprint]) => pendingMutationKeys.delete(fingerprint));
    changed = true;
  }
  return changed;
}

function rememberMutation(fingerprint, key) {
  sweepPendingMutations();
  const current = pendingMutationKeys.get(fingerprint);
  if (!current || current.key !== key) {
    pendingMutationKeys.set(fingerprint, { key, createdAt: Date.now() });
    persistPendingMutations();
  }
}

function forgetMutation(fingerprint) {
  const changed = pendingMutationKeys.delete(fingerprint);
  if (sweepPendingMutations() || changed) persistPendingMutations();
}

function setActorScope(scope) {
  authenticatedActorScope = typeof scope === 'string' && scope ? scope : '';
  if (sweepPendingMutations()) persistPendingMutations();
}

function stableSerialize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function makeIdempotencyKey(action) {
  return `${action.replace(/[^A-Za-z0-9]/g, '_')}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

function timeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error('网络请求超时，请重试');
      error.code = 'TIMEOUT';
      reject(error);
    }, timeoutMs);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }).catch((error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function unwrap(response) {
  if (response && response.ok) return response.data;
  const error = new Error(response && response.error && response.error.message || '服务暂时不可用，请稍后重试');
  error.code = response && response.error && response.error.code || 'INTERNAL';
  error.details = response && response.error && response.error.details;
  throw error;
}

async function invoke(action, data = {}, options = {}) {
  const event = {
    action,
    data,
    requestId: `client:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
  };
  let mutationFingerprint = '';
  if (MUTATING_ACTIONS.has(action)) {
    const actorScope = config.useMock ? mockServer.getPersona() : authenticatedActorScope || 'unauthenticated-session';
    mutationFingerprint = `${actorScope}:${action}:${stableSerialize(data)}`;
    const pending = pendingMutationKeys.get(mutationFingerprint);
    const reusable = pending && Date.now() - pending.createdAt < PENDING_MUTATION_TTL_MS ? pending.key : null;
    const key = options.idempotencyKey || reusable || makeIdempotencyKey(action);
    rememberMutation(mutationFingerprint, key);
    event.idempotencyKey = key;
  }
  let response;
  try {
    if (config.useMock) {
      response = await mockServer.call(event);
    } else {
      const task = wx.cloud.callFunction({ name: config.apiFunction, data: event });
      const result = await timeout(task, config.requestTimeoutMs);
      response = result.result;
    }
    const unwrapped = unwrap(response);
    if (mutationFingerprint) forgetMutation(mutationFingerprint);
    return unwrapped;
  } catch (error) {
    // A received business response is definitive; transport failures keep the key
    // so the user's retry replays the same server-side operation.
    if (mutationFingerprint && response !== undefined) forgetMutation(mutationFingerprint);
    throw error;
  }
}

module.exports = {
  invoke,
  isMutatingAction: (action) => MUTATING_ACTIONS.has(action),
  stableSerialize,
  setActorScope,
  isMock: () => config.useMock,
  setMockPersona: mockServer.setPersona,
  getMockPersona: mockServer.getPersona,
  resetMock: mockServer.reset
};
