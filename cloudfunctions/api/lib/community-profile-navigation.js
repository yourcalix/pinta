'use strict';

const crypto = require('crypto');

const COMMUNITY_PROFILE_NAV_TTL_MS = 60 * 1000;
const COMMUNITY_PROFILE_NAV_PATTERN = /^communityProfileNa_[a-f0-9]{64}$/;

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function createCommunityProfileNavTicket({ viewerId, targetUserId, sourceType, sourceId, at, randomBytes = crypto.randomBytes }) {
  const profileNavToken = `communityProfileNa_${randomBytes(32).toString('hex')}`;
  const hash = tokenHash(profileNavToken);
  const expiresAt = new Date(Date.parse(at) + COMMUNITY_PROFILE_NAV_TTL_MS).toISOString();
  return {
    profileNavToken,
    expiresAt,
    ticket: {
      id: `cpn_${hash}`,
      tokenHash: hash,
      viewerId,
      targetUserId,
      sourceType,
      sourceId,
      status: 'ACTIVE',
      expiresAt,
      createdAt: at,
      updatedAt: at
    }
  };
}

function communityProfileNavTicketId(profileNavToken) {
  return COMMUNITY_PROFILE_NAV_PATTERN.test(String(profileNavToken || ''))
    ? `cpn_${tokenHash(profileNavToken)}`
    : '';
}

function resolveCommunityProfileNavTicket(ticket, profileNavToken, viewerId, at) {
  const id = communityProfileNavTicketId(profileNavToken);
  if (!id || !ticket || ticket.id !== id || ticket.tokenHash !== tokenHash(profileNavToken)) return null;
  if (ticket.status !== 'ACTIVE' || ticket.viewerId !== viewerId || Date.parse(ticket.expiresAt) <= Date.parse(at)) return null;
  return ticket;
}

module.exports = {
  COMMUNITY_PROFILE_NAV_TTL_MS,
  COMMUNITY_PROFILE_NAV_PATTERN,
  createCommunityProfileNavTicket,
  communityProfileNavTicketId,
  resolveCommunityProfileNavTicket
};
