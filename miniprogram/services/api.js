'use strict';

const config = require('../config/runtime');
const mockServer = require('../mocks/server');
const accountDisabledFeedback = require('./account-disabled-feedback');

const MUTATING_ACTIONS = new Set([
  'profile.update',
  'activity.create',
  'activity.cancel',
  'activity.complete',
  'activity.question.ask',
  'activity.question.answer',
  'community.post.create',
  'community.reply.create',
  'community.post.delete',
  'community.reply.delete',
  'application.submit',
  'application.approve',
  'application.reject',
  'application.withdraw',
  'member.leave',
  'dm.conversation.create',
  'dm.message.send',
  'dm.conversation.read',
  'notification.read',
  'report.create',
  'admin.activity.suspend'
]);
const PENDING_MUTATIONS_STORAGE_KEY = 'pinba_pending_mutations_v1';
const PENDING_MUTATION_TTL_MS = 15 * 60 * 1000;
const MAX_PENDING_MUTATIONS = 100;
const SENSITIVE_MUTATING_ACTIONS = new Set([
  'activity.create',
  'community.post.create',
  'community.reply.create',
  'dm.message.send'
]);
const sensitiveFingerprintSalt = `${Date.now()}:${Math.random()}:${Math.random()}`;
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

function clearAuthenticatedSession() {
  setActorScope('');
  try {
    if (typeof getApp !== 'function') return;
    const app = getApp();
    if (app && app.globalData) app.globalData.user = null;
  } catch (error) {
    // Session scope is already cleared; app state may be unavailable during teardown.
  }
}

function stableSerialize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function opaqueFingerprint(value) {
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  const input = `${sensitiveFingerprintSalt}:${value}`;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    hashA = Math.imul(hashA ^ code, 0x01000193) >>> 0;
    hashB = Math.imul(hashB ^ code, 0x85ebca6b) >>> 0;
  }
  return `${hashA.toString(16).padStart(8, '0')}${hashB.toString(16).padStart(8, '0')}`;
}

function makeMutationFingerprint(actorScope, action, data) {
  const serializedData = stableSerialize(data);
  return SENSITIVE_MUTATING_ACTIONS.has(action)
    ? `${actorScope}:${action}:opaque:${opaqueFingerprint(serializedData)}`
    : `${actorScope}:${action}:${serializedData}`;
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

function sanitizeUserFacingMessage(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/当前仅支持(?:澳门|澳門)试点/g, '当前仅支持试点区域')
    .replace(/(?:澳门|澳門)校园/g, '试点区域')
    .replace(/澳门|澳門/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function unwrap(response) {
  if (response && response.ok) return response.data;
  const rawMessage = response && response.error && response.error.message || '服务暂时不可用，请稍后重试';
  const error = new Error(sanitizeUserFacingMessage(rawMessage));
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
    mutationFingerprint = makeMutationFingerprint(actorScope, action, data);
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
    if (mutationFingerprint && response !== undefined && (!error || error.code !== 'INTERNAL')) {
      forgetMutation(mutationFingerprint);
    }
    if (error && error.code === 'ACCOUNT_DISABLED') {
      clearAuthenticatedSession();
      error.handled = true;
      accountDisabledFeedback.present();
    }
    throw error;
  }
}

module.exports = {
  invoke,
  isMutatingAction: (action) => MUTATING_ACTIONS.has(action),
  stableSerialize,
  makeMutationFingerprint,
  sanitizeUserFacingMessage,
  setActorScope,
  getActorScope: () => config.useMock ? `mock:${mockServer.getPersona()}` : authenticatedActorScope,
  isMock: () => config.useMock,
  setMockPersona: mockServer.setPersona,
  getMockPersona: mockServer.getPersona,
  resetMock: mockServer.reset
};
