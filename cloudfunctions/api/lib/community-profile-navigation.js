'use strict';

const crypto = require('crypto');

const COMMUNITY_PROFILE_NAV_TTL_MS = 60 * 1000;
const SOCIAL_PROFILE_NAV_TTL_MS = 5 * 60 * 1000;
const PROFILE_FOLLOW_CURSOR_TTL_MS = 10 * 60 * 1000;
const COMMUNITY_PROFILE_NAV_PATTERN = /^communityProfileNa_[a-f0-9]{64}$/;
const DIRECTORY_PROFILE_NAV_PATTERN = /^directoryProfileNa_[a-f0-9]{64}$/;
const SOCIAL_PROFILE_NAV_PATTERN = /^socialProfileNa_[a-f0-9]{64}$/;
const PROFILE_FOLLOW_CURSOR_PATTERN = /^profileFollowPage_[a-f0-9]{64}$/;

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

function createDirectoryProfileNavTicket({ viewerId, targetUserId, at, randomBytes = crypto.randomBytes }) {
  const profileNavToken = `directoryProfileNa_${randomBytes(32).toString('hex')}`;
  const hash = tokenHash(profileNavToken);
  const expiresAt = new Date(Date.parse(at) + COMMUNITY_PROFILE_NAV_TTL_MS).toISOString();
  return {
    profileNavToken,
    expiresAt,
    ticket: {
      id: `dpn_${hash}`,
      tokenHash: hash,
      viewerId,
      targetUserId,
      sourceType: 'companionDirectory',
      status: 'ACTIVE',
      expiresAt,
      createdAt: at,
      updatedAt: at
    }
  };
}

function directoryProfileNavTicketId(profileNavToken) {
  return DIRECTORY_PROFILE_NAV_PATTERN.test(String(profileNavToken || ''))
    ? `dpn_${tokenHash(profileNavToken)}`
    : '';
}

function resolveDirectoryProfileNavTicket(ticket, profileNavToken, viewerId, at) {
  const id = directoryProfileNavTicketId(profileNavToken);
  if (!id || !ticket || ticket.id !== id || ticket.tokenHash !== tokenHash(profileNavToken)) return null;
  if (ticket.sourceType !== 'companionDirectory' || ticket.status !== 'ACTIVE' || ticket.viewerId !== viewerId || Date.parse(ticket.expiresAt) <= Date.parse(at)) return null;
  return ticket;
}

function createSocialProfileNavTicket({ viewerId, targetUserId, at, randomBytes = crypto.randomBytes }) {
  const profileNavToken = `socialProfileNa_${randomBytes(32).toString('hex')}`;
  const hash = tokenHash(profileNavToken);
  const expiresAt = new Date(Date.parse(at) + SOCIAL_PROFILE_NAV_TTL_MS).toISOString();
  return {
    profileNavToken,
    expiresAt,
    ticket: {
      id: `spn_${hash}`,
      tokenHash: hash,
      viewerId,
      targetUserId,
      sourceType: 'socialProfile',
      status: 'ACTIVE',
      expiresAt,
      createdAt: at,
      updatedAt: at
    }
  };
}

function socialProfileNavTicketId(profileNavToken) {
  return SOCIAL_PROFILE_NAV_PATTERN.test(String(profileNavToken || ''))
    ? `spn_${tokenHash(profileNavToken)}`
    : '';
}

function resolveSocialProfileNavTicket(ticket, profileNavToken, viewerId, at) {
  const id = socialProfileNavTicketId(profileNavToken);
  if (!id || !ticket || ticket.id !== id || ticket.tokenHash !== tokenHash(profileNavToken)) return null;
  if (ticket.sourceType !== 'socialProfile' || ticket.status !== 'ACTIVE' || ticket.viewerId !== viewerId || Date.parse(ticket.expiresAt) <= Date.parse(at)) return null;
  return ticket;
}

function createProfileFollowCursorTicket({ viewerId, followType, anchor, at, randomBytes = crypto.randomBytes }) {
  const cursor = `profileFollowPage_${randomBytes(32).toString('hex')}`;
  const hash = tokenHash(cursor);
  const expiresAt = new Date(Date.parse(at) + PROFILE_FOLLOW_CURSOR_TTL_MS).toISOString();
  return {
    cursor,
    expiresAt,
    ticket: {
      id: `pfc_${hash}`,
      tokenHash: hash,
      viewerId,
      sourceType: 'profileFollowCursor',
      followType,
      anchor: { updatedAt: anchor.updatedAt, id: anchor.id },
      status: 'ACTIVE',
      expiresAt,
      createdAt: at,
      updatedAt: at
    }
  };
}

function profileFollowCursorTicketId(cursor) {
  return PROFILE_FOLLOW_CURSOR_PATTERN.test(String(cursor || ''))
    ? `pfc_${tokenHash(cursor)}`
    : '';
}

function resolveProfileFollowCursorTicket(ticket, cursor, viewerId, followType, at) {
  const id = profileFollowCursorTicketId(cursor);
  if (!id || !ticket || ticket.id !== id || ticket.tokenHash !== tokenHash(cursor)) return null;
  const anchor = ticket.anchor;
  if (ticket.sourceType !== 'profileFollowCursor' || ticket.status !== 'ACTIVE' || ticket.viewerId !== viewerId
    || ticket.followType !== followType || Date.parse(ticket.expiresAt) <= Date.parse(at)) return null;
  if (!anchor || typeof anchor.updatedAt !== 'string' || !Number.isFinite(Date.parse(anchor.updatedAt))
    || typeof anchor.id !== 'string' || !anchor.id) return null;
  return { updatedAt: anchor.updatedAt, id: anchor.id };
}

module.exports = {
  COMMUNITY_PROFILE_NAV_TTL_MS,
  SOCIAL_PROFILE_NAV_TTL_MS,
  PROFILE_FOLLOW_CURSOR_TTL_MS,
  COMMUNITY_PROFILE_NAV_PATTERN,
  DIRECTORY_PROFILE_NAV_PATTERN,
  SOCIAL_PROFILE_NAV_PATTERN,
  PROFILE_FOLLOW_CURSOR_PATTERN,
  createCommunityProfileNavTicket,
  communityProfileNavTicketId,
  resolveCommunityProfileNavTicket,
  createDirectoryProfileNavTicket,
  directoryProfileNavTicketId,
  resolveDirectoryProfileNavTicket,
  createSocialProfileNavTicket,
  socialProfileNavTicketId,
  resolveSocialProfileNavTicket,
  createProfileFollowCursorTicket,
  profileFollowCursorTicketId,
  resolveProfileFollowCursorTicket
};
