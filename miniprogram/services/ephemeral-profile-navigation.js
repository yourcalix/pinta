'use strict';

const DEFAULT_TTL_MS = 15 * 1000;
const tickets = new Map();

function randomKey(now) {
  return `profile_${Number(now).toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function sweep(now = Date.now()) {
  for (const [key, entry] of tickets) {
    if (!entry || entry.expiresAt <= now) tickets.delete(key);
  }
}

function issue(ticket, ttlMs = DEFAULT_TTL_MS, now = Date.now()) {
  sweep(now);
  const key = randomKey(now);
  tickets.set(key, { ticket: { ...ticket }, expiresAt: now + Math.max(1000, Number(ttlMs) || DEFAULT_TTL_MS) });
  return key;
}

function consume(key, now = Date.now()) {
  const normalized = typeof key === 'string' ? key.trim() : '';
  if (!normalized) return null;
  const entry = tickets.get(normalized);
  tickets.delete(normalized);
  if (!entry || entry.expiresAt <= now) return null;
  return { ...entry.ticket };
}

function revoke(key) {
  if (typeof key === 'string') tickets.delete(key);
}

function clear() {
  tickets.clear();
}

module.exports = { issue, consume, revoke, clear };
