'use strict';

const { USER_GENDERS, PASSENGER_AVATAR_KINDS } = require('./constants');
const ACTIVITY_AVATAR_LIMIT = 20;

const EMPTY_AVATAR_KIND = 'EMPTY';
const CUSTOM_AVATAR_KIND = 'CUSTOM';
const DEFAULT_AVATAR_KIND = 'DEFAULT';

function fallbackFromGender(gender) {
  if (gender === 'MALE') return 'MALE_DEFAULT';
  if (gender === 'FEMALE') return 'FEMALE_DEFAULT';
  return null;
}

function avatarKindFromGender(gender) {
  if (gender === 'MALE') return 'PASSENGER_A';
  if (gender === 'FEMALE') return 'PASSENGER_B';
  return null;
}

function isCompleteRideProfile(profile) {
  return Boolean(profile
    && profile.adultConfirmed === true
    && USER_GENDERS.includes(profile.gender));
}

function normalizeAvatarRoster(roster) {
  if (!Array.isArray(roster)) return [];
  const seen = new Set();
  return roster.filter((item) => {
    if (!item || typeof item.memberId !== 'string' || !item.memberId.trim()) return false;
    if (seen.has(item.memberId)) return false;
    seen.add(item.memberId);
    return true;
  }).slice(0, ACTIVITY_AVATAR_LIMIT).map((item) => ({
    memberId: item.memberId,
    avatarKind: PASSENGER_AVATAR_KINDS.includes(item.avatarKind) ? item.avatarKind : null
  }));
}

function upsertAvatarRoster(roster, memberId, avatarKind) {
  if (typeof memberId !== 'string' || !PASSENGER_AVATAR_KINDS.includes(avatarKind)) return normalizeAvatarRoster(roster);
  const next = normalizeAvatarRoster(roster);
  const existing = next.find((item) => item.memberId === memberId);
  if (existing) existing.avatarKind = avatarKind;
  else if (next.length < ACTIVITY_AVATAR_LIMIT) next.push({ memberId, avatarKind });
  return next;
}

function removeAvatarRosterMember(roster, memberId) {
  return normalizeAvatarRoster(roster).filter((item) => item.memberId !== memberId);
}

function publicAvatarSlot(profile) {
  const fallback = fallbackFromGender(profile && profile.gender);
  if (!fallback) return { kind: EMPTY_AVATAR_KIND };
  const src = profile && typeof profile.avatarSrc === 'string' ? profile.avatarSrc.trim() : '';
  if (/^https:\/\//.test(src)) {
    return { kind: CUSTOM_AVATAR_KIND, src, fallback };
  }
  return { kind: DEFAULT_AVATAR_KIND, fallback };
}

function publicAvatarSlots(roster, capacity = 7, profilesByMemberId = {}) {
  const total = Math.max(1, Math.min(ACTIVITY_AVATAR_LIMIT, Math.floor(Number(capacity)) || 7));
  const slots = normalizeAvatarRoster(roster)
    .slice(0, total)
    .map((item) => publicAvatarSlot(profilesByMemberId[item.memberId]));
  while (slots.length < total) slots.push({ kind: EMPTY_AVATAR_KIND });
  return slots;
}

module.exports = {
  EMPTY_AVATAR_KIND,
  CUSTOM_AVATAR_KIND,
  DEFAULT_AVATAR_KIND,
  avatarKindFromGender,
  fallbackFromGender,
  isCompleteRideProfile,
  normalizeAvatarRoster,
  upsertAvatarRoster,
  removeAvatarRosterMember,
  publicAvatarSlot,
  publicAvatarSlots
};
