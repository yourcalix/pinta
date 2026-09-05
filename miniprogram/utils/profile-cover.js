'use strict';

const PROFILE_COVER_STORAGE_KEY = 'pinba_user_cover_preference';
const DEFAULT_PROFILE_COVER = 'macao_seascape';
const AVATAR_AMBIENT_COVER = 'avatar_ambient';
const DEFAULT_PROFILE_COVER_PATH = '/assets/images/profile/profile-default-cover.webp';

const PROFILE_COVER_OPTIONS = Object.freeze([
  Object.freeze({ key: DEFAULT_PROFILE_COVER, label: '澳门海景（推荐）' }),
  Object.freeze({ key: AVATAR_AMBIENT_COVER, label: '头像氛围' })
]);

function normalizeProfileCover(value) {
  return value === AVATAR_AMBIENT_COVER ? AVATAR_AMBIENT_COVER : DEFAULT_PROFILE_COVER;
}

function readProfileCover(platform) {
  try {
    if (!platform || typeof platform.getStorageSync !== 'function') return DEFAULT_PROFILE_COVER;
    return normalizeProfileCover(platform.getStorageSync(PROFILE_COVER_STORAGE_KEY));
  } catch (error) {
    return DEFAULT_PROFILE_COVER;
  }
}

function writeProfileCover(platform, value) {
  if (!PROFILE_COVER_OPTIONS.some((option) => option.key === value)) return false;
  try {
    if (!platform || typeof platform.setStorageSync !== 'function') return false;
    platform.setStorageSync(PROFILE_COVER_STORAGE_KEY, value);
    return true;
  } catch (error) {
    return false;
  }
}

function resolveProfileCover(value, avatarPath) {
  const key = normalizeProfileCover(value);
  const usesAvatar = key === AVATAR_AMBIENT_COVER;
  const option = PROFILE_COVER_OPTIONS.find((item) => item.key === key);
  return {
    key,
    label: option.label,
    path: usesAvatar ? avatarPath : DEFAULT_PROFILE_COVER_PATH,
    usesAvatar
  };
}

module.exports = {
  PROFILE_COVER_STORAGE_KEY,
  DEFAULT_PROFILE_COVER,
  AVATAR_AMBIENT_COVER,
  DEFAULT_PROFILE_COVER_PATH,
  PROFILE_COVER_OPTIONS,
  normalizeProfileCover,
  readProfileCover,
  writeProfileCover,
  resolveProfileCover
};
