'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPinbaService } = require('../cloudfunctions/api/lib/service');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');

const NOW = '2026-09-13T09:00:00.000Z';

function user(id, nickname, gender = 'MALE') {
  return { id, role: 'user', status: 'ACTIVE', profile: { nickname, gender, city: '澳门', interests: [], adultConfirmed: true }, createdAt: NOW, updatedAt: NOW };
}

function setup() {
  const store = new MemoryStore({
    users: [user('author', '阳光小树'), user('replyer', '清风同学', 'FEMALE'), user('liker', '阿志')],
    communityPosts: [{ id: 'post-1', authorId: 'author', author: { nickname: '阳光小树', avatarKind: 'PASSENGER_A' }, content: '今晚奥森南园慢跑 5km，有搭子吗？', replyCount: 0, likeCount: 0, status: 'ACTIVE', createdAt: NOW, updatedAt: NOW }]
  });
  let sequence = 0;
  const service = createPinbaService({ store, clock: () => new Date(NOW), idGenerator: () => `id-${++sequence}` });
  const call = (action, data = {}, actorId = '', key = '') => service.execute({ action, data, requestId: `request-${++sequence}`, ...(key ? { idempotencyKey: key } : {}) }, actorId ? { actorId } : {});
  return { store, call };
}

test('他人回复生成收件人专属动态，自回复不生成', async () => {
  const { call, store } = setup();
  const reply = await call('community.reply.create', { postId: 'post-1', content: '我也打算去，可以一起组队！' }, 'replyer', 'reply-key-1');
  assert.equal(reply.ok, true);
  const feed = await call('community.activity.list', { tab: 'REPLIES' }, 'author');
  assert.equal(feed.ok, true);
  assert.equal(feed.data.items.length, 1);
  assert.equal(feed.data.items[0].type, 'POST_REPLIED');
  assert.equal(feed.data.items[0].postId, 'post-1');
  assert.equal(feed.data.items[0].contentPreview, '我也打算去，可以一起组队！');
  const serialized = JSON.stringify(feed.data);
  ['replyer', 'recipientId', 'actorId', 'openid'].forEach((secret) => assert.equal(serialized.includes(secret), false));

  await call('community.reply.create', { postId: 'post-1', content: '作者补充说明' }, 'author', 'reply-self-key');
  assert.equal(store.communityActivities.size, 1);
});

test('帖子点赞按帖子聚合，取消点赞同步真实人数', async () => {
  const { call } = setup();
  await call('community.like.set', { targetType: 'post', targetId: 'post-1', liked: true }, 'replyer', 'like-key-1');
  await call('community.like.set', { targetType: 'post', targetId: 'post-1', liked: true }, 'liker', 'like-key-2');
  let feed = await call('community.activity.list', { tab: 'LIKES' }, 'author');
  assert.equal(feed.data.items.length, 1);
  assert.equal(feed.data.items[0].type, 'POST_LIKED');
  assert.equal(feed.data.items[0].actorCount, 2);
  assert.equal(feed.data.items[0].actors.length, 2);

  await call('community.like.set', { targetType: 'post', targetId: 'post-1', liked: false }, 'liker', 'unlike-key-1');
  feed = await call('community.activity.list', { tab: 'LIKES' }, 'author');
  assert.equal(feed.data.items[0].actorCount, 1);
});

test('动态只能由收件人读取和标记，删除帖子后正文被安全隐藏', async () => {
  const { call } = setup();
  await call('community.reply.create', { postId: 'post-1', content: '一起跑步吧' }, 'replyer', 'reply-key-2');
  const feed = await call('community.activity.list', { tab: 'ALL' }, 'author');
  const item = feed.data.items[0];
  const forbidden = await call('community.activity.read', { activityId: item.id }, 'liker', 'read-other-key');
  assert.equal(forbidden.error.code, 'NOT_FOUND');
  const read = await call('community.activity.read', { activityId: item.id }, 'author', 'read-owner-key');
  assert.equal(read.data.read, true);

  await call('community.post.delete', { postId: 'post-1' }, 'author', 'delete-post-key');
  const removed = await call('community.activity.list', { tab: 'ALL' }, 'author');
  assert.equal(removed.data.items[0].removed, true);
  assert.equal(removed.data.items[0].postPreview, '');
  assert.equal(removed.data.items[0].contentPreview, '');
});

test('动态分页游标与筛选绑定且游客不能读取', async () => {
  const { call } = setup();
  await call('community.reply.create', { postId: 'post-1', content: '第一条回复' }, 'replyer', 'reply-key-3');
  await call('community.like.set', { targetType: 'post', targetId: 'post-1', liked: true }, 'liker', 'like-key-3');
  const page = await call('community.activity.list', { tab: 'ALL', limit: 1 }, 'author');
  assert.equal(page.ok, true);
  const mismatch = await call('community.activity.list', { tab: 'LIKES', limit: 1, cursor: page.data.nextCursor }, 'author');
  assert.equal(mismatch.error.code, 'VALIDATION_ERROR');
  const guest = await call('community.activity.list', { tab: 'ALL' });
  assert.equal(guest.error.code, 'UNAUTHENTICATED');
});

test('Cloud 动态游标不用 or 查询并保持两条复合索引路径', () => {
  const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/api/lib/cloud-store.js'), 'utf8');
  const method = source.slice(source.indexOf('async listCommunityActivities'), source.indexOf('async markCommunityActivityRead'));
  assert.doesNotMatch(method, /this\.command\.or/);
  assert.match(method, /updatedAt:\s*this\.command\.lt\(cursor\.updatedAt\)/);
  assert.match(method, /updatedAt:\s*cursor\.updatedAt,\s*_id:\s*this\.command\.lt\(cursor\.id\)/);
});
