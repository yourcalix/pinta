'use strict';

const { stableEntityId } = require('./ids');

const COMPANION_PRESENCE_SCENE = 'companion_globe';
const COMPANION_PRESENCE_TTL_MS = 90 * 1000;
const COMPANION_HEARTBEAT_INTERVAL_MS = 30 * 1000;
const COMPANION_MIN_WRITE_INTERVAL_MS = 20 * 1000;
const COMPANION_SAMPLE_LIMIT = 50;
const COMPANION_PROFILE_NAV_BUCKET_MS = 30 * 1000;

function companionPresenceId(userId) {
  return stableEntityId('companionPresence', COMPANION_PRESENCE_SCENE, userId);
}

function layoutSeedForPresence(id) {
  const tail = String(id || '').replace(/[^a-f0-9]/gi, '').slice(-8);
  return Number.parseInt(tail || '1', 16) >>> 0;
}

function safePresenceNickname(value) {
  const text = String(value || '').trim() || '匿名搭子';
  return Array.from(text).slice(0, 12).join('');
}

function profileNavBucket(at) {
  return Math.floor(Date.parse(at) / COMPANION_PROFILE_NAV_BUCKET_MS);
}

function hashSuffix(prefix, ...parts) {
  return stableEntityId(prefix, ...parts).split('_').pop();
}

function createProfileNavNonce(...parts) {
  return hashSuffix('profileNavNonce', ...parts);
}

function profileNavToken(profileNavNonce, sessionNonce, bucket) {
  if (!/^[a-f0-9]{56}$/.test(profileNavNonce || '') || typeof sessionNonce !== 'string' || !sessionNonce) return '';
  const proof = hashSuffix('profileNavProof', profileNavNonce, sessionNonce, bucket);
  return `companionProfileNa_${profileNavNonce}_${Number(bucket).toString(36)}_${proof}`;
}

function profileNavNonceFromToken(token) {
  const match = /^companionProfileNa_([a-f0-9]{56})_([0-9a-z]+)_([a-f0-9]{56})$/.exec(String(token || ''));
  return match ? match[1] : '';
}

function profileNavExpiresAt(item, at) {
  const bucketExpiry = (profileNavBucket(at) + 2) * COMPANION_PROFILE_NAV_BUCKET_MS;
  return new Date(Math.min(Date.parse(item.expiresAt), bucketExpiry)).toISOString();
}

function resolveProfileNavPresence(item, token, at) {
  const currentBucket = profileNavBucket(at);
  return item
    && item.scene === COMPANION_PRESENCE_SCENE
    && item.status === 'ACTIVE'
    && Date.parse(item.expiresAt) > Date.parse(at)
    && [currentBucket, currentBucket - 1].some((bucket) => profileNavToken(item.profileNavNonce, item.sessionNonce, bucket) === token)
    ? item
    : null;
}

function publicCompanionSnapshot(page, actorId, at) {
  const bucket = Math.floor(Date.parse(at) / 15000);
  const users = (page.items || []).slice(0, COMPANION_SAMPLE_LIMIT).map((item) => {
    const nickname = safePresenceNickname(item.nickname);
    const sessionKey = item.sessionNonce
      || stableEntityId('legacyPresenceWindow', nickname, item.expiresAt, bucket);
    return {
      displayToken: stableEntityId('presenceView', sessionKey, bucket),
      profileNavToken: profileNavToken(item.profileNavNonce, item.sessionNonce, profileNavBucket(at)),
      profileNavExpiresAt: item.profileNavNonce && item.sessionNonce ? profileNavExpiresAt(item, at) : null,
      nickname,
      layoutSeed: layoutSeedForPresence(sessionKey),
      viewerIsSelf: Boolean(actorId && item.userId === actorId)
    };
  });
  users.sort((left, right) => String(left.displayToken).localeCompare(String(right.displayToken)));
  return {
    onlineTotal: Math.max(0, Number(page.total) || 0),
    sampleLimit: COMPANION_SAMPLE_LIMIT,
    users,
    serverNow: at
  };
}

module.exports = {
  COMPANION_PRESENCE_SCENE,
  COMPANION_PRESENCE_TTL_MS,
  COMPANION_HEARTBEAT_INTERVAL_MS,
  COMPANION_MIN_WRITE_INTERVAL_MS,
  COMPANION_SAMPLE_LIMIT,
  COMPANION_PROFILE_NAV_BUCKET_MS,
  companionPresenceId,
  layoutSeedForPresence,
  safePresenceNickname,
  createProfileNavNonce,
  profileNavToken,
  profileNavNonceFromToken,
  profileNavExpiresAt,
  resolveProfileNavPresence,
  publicCompanionSnapshot
};
