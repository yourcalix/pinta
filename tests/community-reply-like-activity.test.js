'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPinbaService } = require('../cloudfunctions/api/lib/service');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');
const mockServer = require('../miniprogram/mocks/server');

const NOW = '2026-09-14T08:00:00.000Z';

function user(id, nickname, gender = 'MALE') {
  return {
    id, role: 'user', status: 'ACTIVE',
    profile: { nickname, gender, city: '澳门', interests: [], adultConfirmed: true },
    createdAt: NOW, updatedAt: NOW
  };
}

function setup() {
  const store = new MemoryStore({
    users: [user('post-author', '发帖人'), user('reply-author', '评论者', 'FEMALE'), user('first-liker', '点赞者甲'), user('second-liker', '点赞者乙')],
    communityPosts: [{
      id: 'post-target', authorId: 'post-author', author: { nickname: '发帖人' },
      content: '周末一起去植物园拍照吗？', replyCount: 1, likeCount: 0,
      status: 'ACTIVE', createdAt: NOW, updatedAt: NOW
    }],
    communityReplies: [
      {
        id: 'reply-target', postId: 'post-target', authorId: 'reply-author', author: { nickname: '评论者' },
        content: '我周六有空，可以一起去。', likeCount: 0,
        status: 'ACTIVE', createdAt: NOW, updatedAt: NOW
      },
      {
        id: 'reply-by-post-author', postId: 'post-target', authorId: 'post-author', author: { nickname: '发帖人' },
        content: '欢迎大家来报名。', likeCount: 0,
        status: 'ACTIVE', createdAt: NOW, updatedAt: NOW
      }
    ]
  });
  let sequence = 0;
  const service = createPinbaService({ store, clock: () => new Date(NOW), idGenerator: () => `reply-like-${++sequence}` });
  const call = (action, data, actorId, key = `key-${++sequence}`) => service.execute({
    action, data, requestId: `request-${sequence}`, idempotencyKey: key
  }, actorId ? { actorId } : {});
  return { store, call };
}

test('评论获赞进入评论作者的收到的赞并返回安全摘要', async () => {
  const { call } = setup();
  const liked = await call('community.like.set', { targetType: 'reply', targetId: 'reply-target', liked: true }, 'post-author', 'like-reply-1');
  assert.equal(liked.ok, true);

  const feed = await call('community.activity.list', { tab: 'LIKES' }, 'reply-author');
  assert.equal(feed.ok, true);
  assert.equal(feed.data.items.length, 1);
  assert.equal(feed.data.items[0].type, 'REPLY_LIKED');
  assert.equal(feed.data.items[0].likeTargetType, 'reply');
  assert.equal(feed.data.items[0].actorCount, 1);
  assert.equal(feed.data.items[0].actors[0].nickname, '发帖人');
  assert.equal(feed.data.items[0].contentPreview, '我周六有空，可以一起去。');
  assert.equal(feed.data.items[0].postPreview, '周末一起去植物园拍照吗？');
  const serialized = JSON.stringify(feed.data);
  ['recipientId', 'actorId', 'authorId', 'openid'].forEach((secret) => assert.equal(serialized.includes(secret), false));
});

test('同一评论的点赞聚合，取消到零后动态失活', async () => {
  const { call } = setup();
  await call('community.like.set', { targetType: 'reply', targetId: 'reply-target', liked: true }, 'first-liker', 'like-reply-a');
  await call('community.like.set', { targetType: 'reply', targetId: 'reply-target', liked: true }, 'second-liker', 'like-reply-b');
  let feed = await call('community.activity.list', { tab: 'LIKES' }, 'reply-author');
  assert.equal(feed.data.items.length, 1);
  assert.equal(feed.data.items[0].actorCount, 2);
  assert.equal(feed.data.items[0].actors.length, 2);

  await call('community.like.set', { targetType: 'reply', targetId: 'reply-target', liked: false }, 'first-liker', 'unlike-reply-a');
  feed = await call('community.activity.list', { tab: 'LIKES' }, 'reply-author');
  assert.equal(feed.data.items[0].actorCount, 1);

  await call('community.like.set', { targetType: 'reply', targetId: 'reply-target', liked: false }, 'second-liker', 'unlike-reply-b');
  feed = await call('community.activity.list', { tab: 'LIKES' }, 'reply-author');
  assert.equal(feed.data.items.length, 0);
});

test('自赞不生成评论动态且收到的赞同时合并帖子赞和评论赞分页', async () => {
  const { call, store } = setup();
  await call('community.like.set', { targetType: 'reply', targetId: 'reply-target', liked: true }, 'reply-author', 'self-like-reply');
  assert.equal(store.communityActivities.size, 0);

  await call('community.like.set', { targetType: 'post', targetId: 'post-target', liked: true }, 'first-liker', 'like-post');
  await call('community.like.set', { targetType: 'reply', targetId: 'reply-by-post-author', liked: true }, 'second-liker', 'like-reply');
  const firstPage = await call('community.activity.list', { tab: 'LIKES', limit: 1 }, 'post-author');
  assert.equal(firstPage.data.items.length, 1);
  assert.ok(firstPage.data.nextCursor);
  const secondPage = await call('community.activity.list', { tab: 'LIKES', limit: 1, cursor: firstPage.data.nextCursor }, 'post-author');
  assert.equal(secondPage.data.items.length, 1);
  assert.notEqual(firstPage.data.items[0].id, secondPage.data.items[0].id);
  assert.deepEqual(new Set([firstPage.data.items[0].type, secondPage.data.items[0].type]), new Set(['POST_LIKED', 'REPLY_LIKED']));
  assert.equal(secondPage.data.nextCursor, null);
});

test('被赞评论或原帖删除后动态进入受控失效态', async () => {
  const { call } = setup();
  await call('community.like.set', { targetType: 'reply', targetId: 'reply-target', liked: true }, 'first-liker', 'like-before-delete');
  await call('community.reply.delete', { replyId: 'reply-target' }, 'reply-author', 'delete-liked-reply');
  const feed = await call('community.activity.list', { tab: 'LIKES' }, 'reply-author');
  assert.equal(feed.data.items[0].removed, true);
  assert.equal(feed.data.items[0].contentPreview, '');
  assert.equal(feed.data.items[0].postPreview, '');
});

test('评论获赞后原帖删除也隐藏评论与帖子两段正文', async () => {
  const { call } = setup();
  await call('community.like.set', { targetType: 'reply', targetId: 'reply-target', liked: true }, 'first-liker', 'like-before-post-delete');
  await call('community.post.delete', { postId: 'post-target' }, 'post-author', 'delete-liked-post');
  const feed = await call('community.activity.list', { tab: 'LIKES' }, 'reply-author');
  assert.equal(feed.data.items[0].removed, true);
  assert.equal(feed.data.items[0].contentPreview, '');
  assert.equal(feed.data.items[0].postPreview, '');
});

test('已有评论赞聚合文档的归属字段被污染时事务拒绝复用', async () => {
  const { call, store } = setup();
  await call('community.like.set', { targetType: 'reply', targetId: 'reply-target', liked: true }, 'first-liker', 'first-valid-like');
  const activity = [...store.communityActivities.values()][0];
  activity.recipientId = 'post-author';
  const result = await call('community.like.set', { targetType: 'reply', targetId: 'reply-target', liked: true }, 'second-liker', 'second-like-after-corruption');
  assert.equal(result.error.code, 'CONFLICT');
});

test('Cloud 评论点赞事务校验通知归属且点赞筛选不使用 or 查询', () => {
  const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/api/lib/cloud-store.js'), 'utf8');
  const likeMethod = source.slice(source.indexOf('async setCommunityLikeAtomic'), source.indexOf('async createCommunityPost'));
  const listMethod = source.slice(source.indexOf('async listCommunityActivities'), source.indexOf('async markCommunityActivityRead'));
  assert.match(likeMethod, /activity\.recipientId === target\.authorId/);
  assert.match(likeMethod, /activity\.replyId === target\.id/);
  assert.match(likeMethod, /REPLY_LIKED/);
  assert.doesNotMatch(listMethod, /this\.command\.or/);
  assert.match(listMethod, /activityTypesForTab/);
});

test('Mock 评论点赞动态与真实接口保持同构', async () => {
  mockServer.reset();
  mockServer.setPersona('u_member');
  try {
    const liked = await mockServer.call({
      action: 'community.like.set',
      data: { targetType: 'reply', targetId: 'community_reply_welcome', liked: true },
      requestId: 'mock-reply-like', idempotencyKey: 'mock-reply-like-key'
    });
    assert.equal(liked.ok, true);
    mockServer.setPersona('u_owner');
    const feed = await mockServer.call({
      action: 'community.activity.list', data: { tab: 'LIKES' }, requestId: 'mock-reply-like-feed'
    });
    assert.equal(feed.data.items[0].type, 'REPLY_LIKED');
    assert.equal(feed.data.items[0].actors[0].nickname, '阿同');
    assert.equal(feed.data.items[0].contentPreview, '晚高峰建议多预留半小时。');
  } finally {
    mockServer.reset();
  }
});

test('动态页明确展示评论获赞、我的评论与原讨论', () => {
  const previousPage = global.Page;
  global.Page = () => {};
  const modulePath = require.resolve('../miniprogram/subpackages/community/activity/index');
  delete require.cache[modulePath];
  try {
    const { decorateActivity } = require(modulePath);
    const item = decorateActivity({
      id: 'public-activity', type: 'REPLY_LIKED', postId: 'public-post', replyId: 'public-reply',
      actors: [{ nickname: '阳光小树', avatar: { kind: 'EMPTY' } }], actorCount: 1,
      contentPreview: '我也想参加', postPreview: '周末一起去植物园', removed: false, read: false,
      updatedAt: NOW
    });
    assert.equal(item.actionText, '赞了你的评论');
    assert.equal(item.isReplyLike, true);
    assert.equal(item.isLike, true);
    assert.equal(item.panelLabel, '原讨论：');
    assert.match(item.accessibilityLabel, /我的评论：我也想参加/);
    assert.match(item.accessibilityLabel, /原讨论：周末一起去植物园/);
    const template = fs.readFileSync(path.join(__dirname, '../miniprogram/subpackages/community/activity/index.wxml'), 'utf8');
    assert.match(template, /activity-my-reply-panel/);
    assert.match(template, /\{\{item\.panelLabel\}\}/);
  } finally {
    delete require.cache[modulePath];
    if (previousPage === undefined) delete global.Page; else global.Page = previousPage;
  }
});
