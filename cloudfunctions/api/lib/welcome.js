'use strict';

const { stableEntityId } = require('./ids');

const WELCOME_CAMPAIGN = 'new-user-ip-v1';
const WELCOME_VARIANTS = Object.freeze([
  'WORLD',
  'FOOD',
  'ADVENTURE',
  'SPORT',
  'HOST',
  'ELVES'
]);

function welcomeVariantFor(actorId) {
  const hash = stableEntityId('welcomeVariant', WELCOME_CAMPAIGN, actorId).split('_').pop();
  const bucket = Number.parseInt(hash.slice(0, 12), 16) % WELCOME_VARIANTS.length;
  return WELCOME_VARIANTS[bucket];
}

function newUserWelcome(actorId, at) {
  return {
    ipSplash: {
      campaign: WELCOME_CAMPAIGN,
      variant: welcomeVariantFor(actorId),
      status: 'PENDING',
      assignedAt: at,
      seenAt: null
    }
  };
}

function currentIpSplash(user) {
  const candidate = user && user.welcome && user.welcome.ipSplash;
  if (!candidate || candidate.campaign !== WELCOME_CAMPAIGN) return null;
  if (!WELCOME_VARIANTS.includes(candidate.variant)) return null;
  if (!['PENDING', 'SEEN'].includes(candidate.status)) return null;
  return candidate;
}

function publicWelcome(user) {
  const candidate = currentIpSplash(user);
  return {
    ipSplash: {
      campaign: WELCOME_CAMPAIGN,
      pending: Boolean(candidate && candidate.status === 'PENDING'),
      variant: candidate && candidate.status === 'PENDING' ? candidate.variant : null
    }
  };
}

module.exports = {
  WELCOME_CAMPAIGN,
  WELCOME_VARIANTS,
  welcomeVariantFor,
  newUserWelcome,
  currentIpSplash,
  publicWelcome
};
