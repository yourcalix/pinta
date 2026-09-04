'use strict';

const { USER_GENDERS, PASSENGER_AVATAR_KINDS } = require('./constants');
const ACTIVITY_AVATAR_LIMIT = 20;

const EMPTY_AVATAR_KIND = 'EMPTY';

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
    if (!item || typeof item.memberId !== 'string' || !PASSENGER_AVATAR_KINDS.includes(item.avatarKind)) return false;
    if (seen.has(item.memberId)) return false;
    seen.add(item.memberId);
    return true;
  }).slice(0, ACTIVITY_AVATAR_LIMIT).map((item) => ({
    memberId: item.memberId,
    avatarKind: item.avatarKind
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

function publicAvatarSlots(roster, capacity = 7) {
  const total = Math.max(1, Math.min(ACTIVITY_AVATAR_LIMIT, Math.floor(Number(capacity)) || 7));
  const kinds = normalizeAvatarRoster(roster).map((item) => item.avatarKind).slice(0, total);
  while (kinds.length < total) kinds.push(EMPTY_AVATAR_KIND);
  return kinds.map((kind) => ({ kind }));
}

module.exports = {
  EMPTY_AVATAR_KIND,
  avatarKindFromGender,
  isCompleteRideProfile,
  normalizeAvatarRoster,
  upsertAvatarRoster,
  removeAvatarRosterMember,
  publicAvatarSlots
};
