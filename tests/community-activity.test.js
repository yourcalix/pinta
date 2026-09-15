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

test('近30天未读汇总按全部、回复与点赞返回权威计数', async () => {
  const { call, store } = setup();
  await call('community.reply.create', { postId: 'post-1', content: '一起跑步吧' }, 'replyer', 'unread-reply-key');
  await call('community.like.set', { targetType: 'post', targetId: 'post-1', liked: true }, 'liker', 'unread-like-key');
  store.communityActivities.set('old-activity', {
    id: 'old-activity', type: 'POST_REPLIED', recipientId: 'author', postId: 'post-1', status: 'ACTIVE', read: false,
    createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z'
  });

  const unread = await call('community.activity.unread', {}, 'author');
  assert.equal(unread.ok, true);
  assert.deepEqual(unread.data, { total: 2, tabs: { ALL: 2, REPLIES: 1, LIKES: 1 } });
});

test('详情阅读按帖子与活动版本消费，旧版本不能清除随后到达的新赞', async () => {
  const { call, store } = setup();
  await call('community.like.set', { targetType: 'post', targetId: 'post-1', liked: true }, 'liker', 'version-like-key');
  const feed = await call('community.activity.list', { tab: 'LIKES' }, 'author');
  const item = feed.data.items[0];

  const wrongPost = await call('community.activity.read', {
    activityId: item.id, postId: 'another-post', expectedUpdatedAt: item.updatedAt
  }, 'author', 'wrong-post-read-key');
  assert.equal(wrongPost.error.code, 'NOT_FOUND');

  store.communityActivities.get(item.id).updatedAt = '2026-09-13T09:00:01.000Z';
  const stale = await call('community.activity.read', {
    activityId: item.id, postId: 'post-1', expectedUpdatedAt: item.updatedAt
  }, 'author', 'stale-read-key');
  assert.equal(stale.data.stale, true);
  assert.equal(stale.data.read, false);
  assert.equal((await call('community.activity.unread', {}, 'author')).data.total, 1);

  const consumed = await call('community.activity.read', {
    activityId: item.id, postId: 'post-1', expectedUpdatedAt: '2026-09-13T09:00:01.000Z'
  }, 'author', 'current-read-key');
  assert.equal(consumed.data.stale, false);
  assert.equal(consumed.data.read, true);
  assert.equal((await call('community.activity.unread', {}, 'author')).data.total, 0);
});

test('已读动作每次检查当前业务状态且不能消费失活动态', async () => {
  const { call, store } = setup();
  await call('community.like.set', { targetType: 'post', targetId: 'post-1', liked: true }, 'liker', 'inactive-like-key');
  const item = (await call('community.activity.list', { tab: 'LIKES' }, 'author')).data.items[0];
  store.communityActivities.get(item.id).status = 'INACTIVE';
  const result = await call('community.activity.read', {
    activityId: item.id, postId: 'post-1', expectedUpdatedAt: item.updatedAt
  }, 'author', 'inactive-read-key');
  assert.equal(result.error.code, 'NOT_FOUND');

  const serviceSource = fs.readFileSync(path.join(__dirname, '../cloudfunctions/api/lib/service.js'), 'utf8');
  const businessActions = serviceSource.slice(serviceSource.indexOf('const BUSINESS_IDEMPOTENT_ACTIONS'), serviceSource.indexOf('const REMOVED_ACTIONS'));
  assert.match(businessActions, /community\.activity\.read/);
});

test('Cloud 动态游标不用 or 查询并保持两条复合索引路径', () => {
  const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/api/lib/cloud-store.js'), 'utf8');
  const method = source.slice(source.indexOf('async listCommunityActivities'), source.indexOf('async markCommunityActivityRead'));
  assert.doesNotMatch(method, /this\.command\.or/);
  assert.match(method, /updatedAt:\s*this\.command\.lt\(cursor\.updatedAt\)/);
  assert.match(method, /updatedAt:\s*cursor\.updatedAt,\s*_id:\s*this\.command\.lt\(cursor\.id\)/);
});

test('Cloud 未读汇总使用完整 count 且已读事务比较活动版本', () => {
  const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/api/lib/cloud-store.js'), 'utf8');
  const countMethod = source.slice(source.indexOf('async countUnreadCommunityActivities'), source.indexOf('async markCommunityActivityRead'));
  const readMethod = source.slice(source.indexOf('async markCommunityActivityRead'), source.indexOf('async deleteCommunityPost'));
  assert.match(countMethod, /\.where\(where\)\.count\(\)/);
  assert.match(countMethod, /read:\s*false/);
  assert.match(countMethod, /updatedAt:\s*this\.command\.gte\(cutoff\)/);
  assert.match(readMethod, /runTransaction/);
  assert.match(readMethod, /activity\.updatedAt !== options\.expectedUpdatedAt/);
  assert.match(readMethod, /activity\.postId === options\.postId/);
});
