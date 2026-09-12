'use strict';

const { stableEntityId } = require('./ids');

const COMPANION_PRESENCE_SCENE = 'companion_globe';
const COMPANION_PRESENCE_TTL_MS = 90 * 1000;
const COMPANION_HEARTBEAT_INTERVAL_MS = 30 * 1000;
const COMPANION_MIN_WRITE_INTERVAL_MS = 20 * 1000;
const COMPANION_SAMPLE_LIMIT = 50;

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

function publicCompanionSnapshot(page, actorId, at) {
  const bucket = Math.floor(Date.parse(at) / 15000);
  const users = (page.items || []).slice(0, COMPANION_SAMPLE_LIMIT).map((item) => {
    const nickname = safePresenceNickname(item.nickname);
    const sessionKey = item.sessionNonce
      || stableEntityId('legacyPresenceWindow', nickname, item.expiresAt, bucket);
    return {
      displayToken: stableEntityId('presenceView', sessionKey, bucket),
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
  companionPresenceId,
  layoutSeedForPresence,
  safePresenceNickname,
  publicCompanionSnapshot
};
