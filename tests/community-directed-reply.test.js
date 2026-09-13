'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPinbaService } = require('../cloudfunctions/api/lib/service');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');
const mockServer = require('../miniprogram/mocks/server');

const NOW = '2026-09-13T10:00:00.000Z';
const user = (id, nickname) => ({
  id, role: 'user', status: 'ACTIVE',
  profile: { nickname, gender: 'MALE', city: '澳门', interests: [], adultConfirmed: true },
  createdAt: NOW, updatedAt: NOW
});

function setup() {
  const store = new MemoryStore({
    users: [user('author', '发帖人'), user('replyer', '评论者'), user('other', '其他人')],
    communityPosts: [
      { id: 'post-1', authorId: 'author', author: { nickname: '发帖人' }, content: '第一篇讨论', replyCount: 0, status: 'ACTIVE', createdAt: NOW, updatedAt: NOW },
      { id: 'post-2', authorId: 'other', author: { nickname: '其他人' }, content: '第二篇讨论', replyCount: 0, status: 'ACTIVE', createdAt: NOW, updatedAt: NOW }
    ]
  });
  let sequence = 0;
  const service = createPinbaService({ store, clock: () => new Date(NOW), idGenerator: () => `directed-${++sequence}` });
  const call = (action, data, actorId, key = `key-${++sequence}`) => service.execute({ action, data, requestId: `request-${sequence}`, idempotencyKey: key }, actorId ? { actorId } : {});
  return { store, call };
}

test('定向回复保持单层结构并把动态发送给被回复者', async () => {
  const { store, call } = setup();
  const base = await call('community.reply.create', { postId: 'post-1', content: '我想参加' }, 'replyer', 'base-reply');
  const directed = await call('community.reply.create', {
    postId: 'post-1', content: '可以，一起去吧', replyToId: base.data.reply.id
  }, 'author', 'directed-reply');

  assert.equal(directed.ok, true);
  assert.equal(store.communityReplies.get(directed.data.reply.id).replyToId, base.data.reply.id);
  assert.deepEqual(directed.data.reply.replyTo, { status: 'ACTIVE', nickname: '评论者' });
  const detail = await call('community.post.detail', { postId: 'post-1', limit: 30 }, 'author');
  assert.equal(detail.data.replies.length, 2);
  assert.deepEqual(detail.data.replies.find((item) => item.id === directed.data.reply.id).replyTo, { status: 'ACTIVE', nickname: '评论者' });
  const feed = await call('community.activity.list', { tab: 'REPLIES' }, 'replyer');
  assert.equal(feed.data.items.length, 1);
  assert.equal(feed.data.items[0].replyId, directed.data.reply.id);
  const serialized = JSON.stringify(directed.data.reply);
  assert.equal(serialized.includes('replyToId'), false);
  assert.equal(serialized.includes('authorId'), false);
  assert.equal(serialized.includes('recipientId'), false);
});

test('定向回复拒绝跨帖和失效目标，目标删除后公开DTO安全降级', async () => {
  const { call } = setup();
  const target = await call('community.reply.create', { postId: 'post-1', content: '目标评论' }, 'replyer', 'target-reply');
  const crossPost = await call('community.reply.create', {
    postId: 'post-2', content: '错误跨帖回复', replyToId: target.data.reply.id
  }, 'author', 'cross-post-reply');
  assert.equal(crossPost.error.code, 'NOT_FOUND');

  await call('community.reply.delete', { replyId: target.data.reply.id }, 'replyer', 'delete-target');
  const deletedTarget = await call('community.reply.create', {
    postId: 'post-1', content: '不能回复已删除内容', replyToId: target.data.reply.id
  }, 'author', 'deleted-target-reply');
  assert.equal(deletedTarget.error.code, 'NOT_FOUND');
});

test('已创建的定向回复在目标评论后来删除时显示已失效且幂等重放不重复通知', async () => {
  const { store, call } = setup();
  const target = await call('community.reply.create', { postId: 'post-1', content: '目标评论' }, 'replyer', 'target-for-delete');
  const payload = { postId: 'post-1', content: '收到你的评论', replyToId: target.data.reply.id };
  const first = await call('community.reply.create', payload, 'author', 'stable-directed-key');
  const replay = await call('community.reply.create', payload, 'author', 'stable-directed-key');
  assert.equal(replay.idempotentReplay, true);
  assert.equal(store.communityActivities.size, 2);

  await call('community.reply.delete', { replyId: target.data.reply.id }, 'replyer', 'remove-target-afterward');
  const detail = await call('community.post.detail', { postId: 'post-1', limit: 30 }, 'author');
  const child = detail.data.replies.find((item) => item.id === first.data.reply.id);
  assert.deepEqual(child.replyTo, { status: 'UNAVAILABLE', nickname: '' });
  const replayAfterDelete = await call('community.reply.create', payload, 'author', 'stable-directed-key');
  assert.equal(replayAfterDelete.idempotentReplay, true);
  assert.deepEqual(replayAfterDelete.data.reply.replyTo, { status: 'UNAVAILABLE', nickname: '' });
});

test('回复自己的评论不生成自己的动态，未知创建字段被拒绝', async () => {
  const { store, call } = setup();
  const own = await call('community.reply.create', { postId: 'post-1', content: '自己的评论' }, 'replyer', 'own-base');
  const activityCount = store.communityActivities.size;
  const selfReply = await call('community.reply.create', {
    postId: 'post-1', content: '补充一下', replyToId: own.data.reply.id
  }, 'replyer', 'own-directed');
  assert.equal(selfReply.ok, true);
  assert.equal(store.communityActivities.size, activityCount);
  const unknown = await call('community.reply.create', { postId: 'post-1', content: '非法字段', recipientId: 'author' }, 'replyer', 'unknown-field');
  assert.equal(unknown.error.code, 'VALIDATION_ERROR');
});

test('空值replyToId按普通回复兼容旧客户端', async () => {
  const { call } = setup();
  for (const [index, replyToId] of ['', null].entries()) {
    const result = await call('community.reply.create', { postId: 'post-1', content: `普通回复${index}`, replyToId }, 'replyer', `empty-target-${index}`);
    assert.equal(result.ok, true);
    assert.equal(result.data.reply.replyTo, undefined);
  }
});

test('Cloud回复事务包含目标评论归属与通知接收人复核', () => {
  const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/api/lib/cloud-store.js'), 'utf8');
  const method = source.slice(source.indexOf('async createCommunityReply'), source.indexOf('async getCommunityReply'));
  assert.match(method, /reply\.replyToId/);
  assert.match(method, /targetReply\.postId === reply\.postId/);
  assert.match(method, /activity\.recipientId === expectedRecipientId/);
});

test('Mock与真实接口同样支持定向回复公开DTO', async () => {
  mockServer.reset();
  mockServer.setPersona('u_member');
  try {
    const result = await mockServer.call({
      action: 'community.reply.create',
      data: { postId: 'community_welcome', content: '定向回复小拼', replyToId: 'community_reply_welcome' },
      requestId: 'mock-directed-request',
      idempotencyKey: 'mock-directed-key'
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.data.reply.replyTo, { status: 'ACTIVE', nickname: '小拼' });
    assert.equal(JSON.stringify(result.data.reply).includes('replyToId'), false);
  } finally {
    mockServer.reset();
  }
});
