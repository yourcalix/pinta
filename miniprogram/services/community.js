'use strict';

const api = require('./api');

const ACTIVITY_READ_BARRIER_TIMEOUT_MS = 2000;
const pendingActivityReads = new Set();

function trackActivityRead(promise) {
  const tracked = Promise.resolve(promise);
  pendingActivityReads.add(tracked);
  const release = () => { pendingActivityReads.delete(tracked); };
  tracked.then(release, release);
  return tracked;
}

async function waitForPendingActivityReads() {
  const pending = [...pendingActivityReads];
  if (!pending.length) return;
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, ACTIVITY_READ_BARRIER_TIMEOUT_MS);
  });
  try {
    await Promise.race([Promise.allSettled(pending), timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function listActivities(filters = {}) {
  await waitForPendingActivityReads();
  return api.invoke('community.activity.list', filters);
}

async function getActivityUnread() {
  await waitForPendingActivityReads();
  return api.invoke('community.activity.unread');
}

function readActivity(activityId, expectedUpdatedAt = '', postId = '') {
  return trackActivityRead(api.invoke('community.activity.read', {
    activityId,
    ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
    ...(postId ? { postId } : {})
  }, { mutating: true }));
}

module.exports = {
  listPosts: (filters = {}) => api.invoke('community.post.list', filters),
  getPost: (postId, filters = {}) => api.invoke('community.post.detail', { postId, ...filters }),
  createProfileNavigation: (sourceType, sourceId) => api.invoke('community.profile.nav.create', { sourceType, sourceId }, { mutating: true }),
  createPost: (content) => api.invoke('community.post.create', { content }, { mutating: true }),
  createReply: (postId, content, replyToId = '') => api.invoke('community.reply.create', { postId, content, ...(replyToId ? { replyToId } : {}) }, { mutating: true }),
  deletePost: (postId) => api.invoke('community.post.delete', { postId }, { mutating: true }),
  deleteReply: (replyId) => api.invoke('community.reply.delete', { replyId }, { mutating: true }),
  setLike: (targetType, targetId, liked) => api.invoke('community.like.set', { targetType, targetId, liked }, { mutating: true }),
  listActivities,
  getActivityUnread,
  readActivity
};
