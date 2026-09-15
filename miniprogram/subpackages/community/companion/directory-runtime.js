'use strict';

const MAX_RENDERED_USERS = 50;
const FAST_DIRECTORY_POLL_MS = 9_000;
const STEADY_DIRECTORY_POLL_MS = 18_000;
const FAST_DIRECTORY_STAGE_MS = 60_000;
const DIRECTORY_POLL_BACKOFF_MS = [10_000, 20_000, 40_000, 60_000];
const COLORS = ['#b9f4ef', '#f3d0d1', '#91dfdc', '#d9c7d7', '#c8eee9'];

function seededUnit(seed, salt) {
  let value = (Number(seed) ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  return (value >>> 0) / 4294967296;
}

function nodeIdentity(user) {
  if (user && typeof user.renderKey === 'string' && user.renderKey) return `render:${user.renderKey}`;
  return `layout:${Number(user && user.layoutSeed) >>> 0}:${String(user && user.nickname || '')}`;
}

function createSphereNode(user, enteredAt) {
  const seed = Number(user && user.layoutSeed) >>> 0;
  const y = 1 - 2 * seededUnit(seed, 3);
  const radial = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = seededUnit(seed, 4) * Math.PI * 2;
  return {
    ...user,
    nodeKey: nodeIdentity(user),
    x: Math.cos(theta) * radial,
    y,
    z: Math.sin(theta) * radial,
    color: COLORS[seed % COLORS.length],
    labelSide: seededUnit(seed, 2) > .5 ? 1 : -1,
    enteredAt
  };
}

function mergeSphereNodes(previousNodes, users, now = Date.now()) {
  const previousByKey = new Map((previousNodes || []).map((node) => [nodeIdentity(node), node]));
  return (users || []).slice(0, MAX_RENDERED_USERS).map((user) => {
    const key = nodeIdentity(user);
    const current = previousByKey.get(key);
    if (!current) return createSphereNode(user, now);
    return {
      ...current,
      ...user,
      nodeKey: key,
      x: current.x,
      y: current.y,
      z: current.z,
      color: current.color,
      labelSide: current.labelSide,
      enteredAt: current.enteredAt
    };
  });
}

function nextDirectoryPollDelay({ elapsedMs = 0, failureCount = 0 } = {}) {
  if (failureCount > 0) {
    return DIRECTORY_POLL_BACKOFF_MS[Math.min(failureCount - 1, DIRECTORY_POLL_BACKOFF_MS.length - 1)];
  }
  return elapsedMs < FAST_DIRECTORY_STAGE_MS ? FAST_DIRECTORY_POLL_MS : STEADY_DIRECTORY_POLL_MS;
}

module.exports = {
  MAX_RENDERED_USERS,
  FAST_DIRECTORY_POLL_MS,
  STEADY_DIRECTORY_POLL_MS,
  DIRECTORY_POLL_BACKOFF_MS,
  nodeIdentity,
  mergeSphereNodes,
  nextDirectoryPollDelay
};
