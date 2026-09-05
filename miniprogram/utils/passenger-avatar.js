'use strict';

const AVATAR_PATHS = Object.freeze({
  MALE_DEFAULT: '/assets/images/profile/profile-avatar-male-painted.webp',
  FEMALE_DEFAULT: '/assets/images/profile/profile-avatar-female-painted.webp',
  NEUTRAL_DEFAULT: '/assets/images/profile/profile-avatar-neutral-painted.webp'
});

const PROFILE_AVATAR_PATHS = Object.freeze({
  MALE: '/assets/images/profile/profile-avatar-male-painted.webp',
  FEMALE: '/assets/images/profile/profile-avatar-female-painted.webp',
  EMPTY: '/assets/images/profile/profile-avatar-neutral-painted.webp'
});

function avatarKindFromGender(gender) {
  if (gender === 'MALE') return 'MALE_DEFAULT';
  if (gender === 'FEMALE') return 'FEMALE_DEFAULT';
  return 'EMPTY';
}

function avatarPathFromKind(kind) {
  if (kind === 'PASSENGER_A') return AVATAR_PATHS.MALE_DEFAULT;
  if (kind === 'PASSENGER_B') return AVATAR_PATHS.FEMALE_DEFAULT;
  return AVATAR_PATHS[kind] || '';
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
    const legacyFallback = raw.kind === 'PASSENGER_A'
      ? 'MALE_DEFAULT'
      : raw.kind === 'PASSENGER_B' ? 'FEMALE_DEFAULT' : '';
    const fallback = ['MALE_DEFAULT', 'FEMALE_DEFAULT'].includes(raw.fallback)
      ? raw.fallback
      : legacyFallback;
    const fallbackSrc = avatarPathFromKind(fallback);
    const customSrc = typeof raw.src === 'string' ? raw.src.trim() : '';
    const safeCustomSrc = /^(?:https:\/\/|wxfile:\/\/|http:\/\/(?:tmp|usr)\/|\/tmp\/|\/var\/)/.test(customSrc)
      && !/avatar-passenger-(?:a|b)|passenger_(?:a|b)/i.test(customSrc);
    const custom = raw.kind === 'CUSTOM' && safeCustomSrc && Boolean(fallbackSrc);
    const isDefault = (raw.kind === 'DEFAULT' || Boolean(legacyFallback) || (raw.kind === 'CUSTOM' && !safeCustomSrc))
      && Boolean(fallbackSrc);
    const empty = !custom && !isDefault;
    return {
      id: `slot-${index + 1}`,
      kind: custom ? 'CUSTOM' : isDefault ? 'DEFAULT' : 'EMPTY',
      src: custom ? customSrc : isDefault ? fallbackSrc : '',
      fallbackSrc,
      custom,
      failed: false,
      mode: custom ? 'aspectFill' : 'aspectFit',
      empty
    };
  });
}

function fallbackAvatarSlot(slot) {
  if (!slot || slot.empty || slot.failed || !slot.custom || !slot.fallbackSrc) return slot;
  return {
    ...slot,
    kind: 'DEFAULT',
    src: slot.fallbackSrc,
    custom: false,
    failed: true,
    mode: 'aspectFit'
  };
}

module.exports = {
  AVATAR_PATHS,
  PROFILE_AVATAR_PATHS,
  avatarKindFromGender,
  avatarPathFromKind,
  profileAvatarPath,
  normalizeAvatarSlots,
  fallbackAvatarSlot
};
