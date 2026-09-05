'use strict';

const { profileAvatarPath } = require('./passenger-avatar');

function customProfileAvatarPath(profile) {
  const avatar = profile && profile.avatar;
  return avatar && typeof avatar.fileID === 'string' && avatar.fileID ? avatar.fileID : '';
}

function resolveProfileAvatar(profile) {
  const fallbackPath = profileAvatarPath(profile && profile.gender);
  const customPath = customProfileAvatarPath(profile);
  return { path: customPath || fallbackPath, fallbackPath, custom: Boolean(customPath) };
}

module.exports = { customProfileAvatarPath, resolveProfileAvatar };
