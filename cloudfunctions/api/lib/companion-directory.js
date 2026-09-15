'use strict';

const { stableEntityId } = require('./ids');
const { safePresenceNickname } = require('./companion-presence');

const COMPANION_DIRECTORY_SAMPLE_LIMIT = 50;
const COMPANION_DIRECTORY_TOKEN_BUCKET_MS = 5 * 60 * 1000;

function isCompanionDirectoryUser(user) {
  return Boolean(user && user.status === 'ACTIVE');
}

function directoryTokenBucket(at) {
  return Math.floor(Date.parse(at) / COMPANION_DIRECTORY_TOKEN_BUCKET_MS);
}

function companionDirectoryDisplayToken(userId, bucket) {
  return stableEntityId('companionDirView', userId, bucket);
}

function layoutSeedForDirectory(userId) {
  const tail = stableEntityId('companionDirLayout', userId).replace(/[^a-f0-9]/gi, '').slice(-8);
  return Number.parseInt(tail || '1', 16) >>> 0;
}

function publicCompanionDirectorySnapshot(page, onlineTotal, actorId, at) {
  const bucket = directoryTokenBucket(at);
  const users = (page.items || [])
    .filter(isCompanionDirectoryUser)
    .slice(0, COMPANION_DIRECTORY_SAMPLE_LIMIT)
    .map((user) => {
      const displayToken = companionDirectoryDisplayToken(user.id, bucket);
      return {
        displayToken,
        nickname: safePresenceNickname(user.profile && user.profile.nickname),
        layoutSeed: layoutSeedForDirectory(user.id),
        viewerIsSelf: Boolean(actorId && user.id === actorId)
      };
    });
  return {
    onlineTotal: Math.max(0, Number(onlineTotal) || 0),
    users,
    serverNow: at
  };
}

function resolveCompanionDirectoryUser(users, displayToken, at) {
  const bucket = directoryTokenBucket(at);
  return (users || []).find((user) => isCompanionDirectoryUser(user)
    && [bucket, bucket - 1].some((candidate) => companionDirectoryDisplayToken(user.id, candidate) === displayToken)) || null;
}

module.exports = {
  COMPANION_DIRECTORY_SAMPLE_LIMIT,
  COMPANION_DIRECTORY_TOKEN_BUCKET_MS,
  isCompanionDirectoryUser,
  directoryTokenBucket,
  companionDirectoryDisplayToken,
  layoutSeedForDirectory,
  publicCompanionDirectorySnapshot,
  resolveCompanionDirectoryUser
};
