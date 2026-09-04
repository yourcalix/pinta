'use strict';

const AVATAR_PATHS = Object.freeze({
  PASSENGER_A: '/assets/images/discover/avatar-passenger-a.png',
  PASSENGER_B: '/assets/images/discover/avatar-passenger-b.png',
  EMPTY: '/assets/images/discover/avatar-passenger-empty.png'
});

const PROFILE_AVATAR_PATHS = Object.freeze({
  MALE: '/assets/images/profile/profile-avatar-male-painted.webp',
  FEMALE: '/assets/images/profile/profile-avatar-female-painted.webp',
  EMPTY: '/assets/images/profile/profile-avatar-neutral-painted.webp'
});

function avatarKindFromGender(gender) {
  if (gender === 'MALE') return 'PASSENGER_A';
  if (gender === 'FEMALE') return 'PASSENGER_B';
  return 'EMPTY';
}

function avatarPathFromKind(kind) {
  return AVATAR_PATHS[kind] || AVATAR_PATHS.EMPTY;
}

function profileAvatarPath(gender) {
  if (gender === 'MALE') return PROFILE_AVATAR_PATHS.MALE;
  if (gender === 'FEMALE') return PROFILE_AVATAR_PATHS.FEMALE;
  return PROFILE_AVATAR_PATHS.EMPTY;
}

function normalizeAvatarSlots(slots, total = 7) {
  const safeTotal = Math.max(1, Math.min(20, Math.floor(Number(total)) || 7));
  const source = Array.isArray(slots) ? slots : [];
  return Array.from({ length: safeTotal }, (_, index) => {
    const raw = source[index] || {};
    const serverKind = raw.kind === 'PASSENGER_A' || raw.kind === 'PASSENGER_B' ? raw.kind : 'EMPTY';
    return {
      id: index + 1,
      kind: serverKind,
      src: avatarPathFromKind(serverKind),
      empty: serverKind === 'EMPTY'
    };
  });
}

module.exports = {
  AVATAR_PATHS,
  PROFILE_AVATAR_PATHS,
  avatarKindFromGender,
  avatarPathFromKind,
  profileAvatarPath,
  normalizeAvatarSlots
};
