'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPinbaService } = require('../cloudfunctions/api/lib/service');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');

const NOW = '2026-08-30T09:00:00.000Z';

function user(id, nickname, gender = 'MALE', overrides = {}) {
  return {
    id,
    role: 'user',
    status: 'ACTIVE',
    profile: { nickname, gender, city: '澳门', interests: [], adultConfirmed: true },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function setup(seed = {}) {
  const store = new MemoryStore({
    users: [
      user('author-id', '阿明'),
      user('reply-id', '小琴', 'FEMALE'),
      user('other-id', '同学'),
      user('incomplete-id', '资料未完成', null, { profile: { nickname: '资料未完成', adultConfirmed: true } })
    ],
    ...seed
  });
  let request = 0;
  const service = createPinbaService({ store, clock: () => new Date(NOW), idGenerator: () => `generated-${++request}` });
  const call = (action, data = {}, actorId = null, key) => service.execute({
    action,
    data,
    requestId: `community-${++request}`,
    ...(key ? { idempotencyKey: key } : {})
  }, actorId ? { actorId } : {});
  return { store, call };
}

test('游客可浏览社区，公开 DTO 不泄露内部身份字段', async () => {
  const { call } = setup({
    communityPosts: [{
      id: 'post-1', authorId: 'author-id', author: { nickname: '阿明', avatarKind: 'PASSENGER_A' },
      content: '校园互助讨论', replyCount: 0, status: 'ACTIVE',
      submissionKeyHash: 'private-hash', moderation: { provider: 'private' }, createdAt: NOW, updatedAt: NOW
    }]
  });
  const page = await call('community.post.list');
  assert.equal(page.ok, true);
  assert.equal(page.data.items[0].content, '校园互助讨论');
  assert.equal(JSON.stringify(page.data).includes('author-id'), false);
  assert.equal(JSON.stringify(page.data).includes('private-'), false);
});

test('完整资料用户可幂等发帖，缺资料、链接和联系方式均被拒绝', async () => {
  const { call, store } = setup();
  const input = { content: '横琴口岸晚间人多吗？大家有什么建议？' };
  const first = await call('community.post.create', input, 'author-id', 'community-create-001');
  const replay = await call('community.post.create', input, 'author-id', 'community-create-001');
  assert.equal(first.ok, true);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(store.communityPosts.size, 1);
  assert.equal(first.data.post.author.avatarKind, 'PASSENGER_A');

  const incomplete = await call('community.post.create', input, 'incomplete-id', 'community-create-002');
  assert.equal(incomplete.error.code, 'PROFILE_INCOMPLETE');
  const external = await call('community.post.create', { content: '详情见 https://example.com 或微信 abc123' }, 'author-id', 'community-create-003');
  assert.equal(external.error.code, 'VALIDATION_ERROR');
  const obfuscated = await call('community.post.create', { content: '可加 微 信 a b c 1 2 3 4' }, 'author-id', 'community-create-004');
  assert.equal(obfuscated.error.code, 'VALIDATION_ERROR');
});

test('回复为一层结构且作者只能软删除自己的内容', async () => {
  const { call, store } = setup();
  const created = await call('community.post.create', { content: '请问凼仔校园附近有哪些安静自习点？' }, 'author-id', 'community-create-010');
  const postId = created.data.post.id;
  const reply = await call('community.reply.create', { postId, content: '图书馆二楼晚上比较安静。' }, 'reply-id', 'community-reply-010');
  assert.equal(reply.ok, true);
  assert.equal(reply.data.reply.author.avatarKind, 'PASSENGER_B');
  assert.equal(store.communityPosts.get(postId).replyCount, 1);

  const forbidden = await call('community.post.delete', { postId }, 'other-id', 'community-delete-010');
  assert.equal(forbidden.error.code, 'FORBIDDEN');
  const deleted = await call('community.reply.delete', { replyId: reply.data.reply.id }, 'reply-id', 'community-delete-011');
  assert.equal(deleted.ok, true);
  assert.equal(store.communityPosts.get(postId).replyCount, 0);
});

test('帖子列表游标稳定分页，已删除内容不再公开', async () => {
  const posts = Array.from({ length: 5 }, (_, index) => ({
    id: `post-${index}`,
    authorId: 'author-id',
    author: { nickname: '阿明', avatarKind: 'PASSENGER_A' },
    content: `帖子 ${index}`,
    replyCount: 0,
    status: 'ACTIVE',
    createdAt: `2026-08-30T09:00:0${index}.000Z`,
    updatedAt: `2026-08-30T09:00:0${index}.000Z`
  }));
  const { call } = setup({ communityPosts: posts });
  const first = await call('community.post.list', { limit: 2 });
  assert.deepEqual(first.data.items.map((item) => item.id), ['post-4', 'post-3']);
  assert.ok(first.data.nextCursor);
  const second = await call('community.post.list', { limit: 2, cursor: first.data.nextCursor });
  assert.deepEqual(second.data.items.map((item) => item.id), ['post-2', 'post-1']);
});

test('帖子搜索只匹配ACTIVE正文并把关键词绑定到分页游标', async () => {
  const posts = [
    { id: 'post-5', authorId: 'author-id', author: { nickname: '露营达人' }, content: '普通闲聊', replyCount: 0, status: 'ACTIVE', createdAt: '2026-08-30T09:00:05.000Z', updatedAt: NOW },
    { id: 'post-4', authorId: 'author-id', author: { nickname: '阿明' }, content: '周末露营寻找搭子', replyCount: 0, status: 'ACTIVE', createdAt: '2026-08-30T09:00:04.000Z', updatedAt: NOW },
    { id: 'post-3', authorId: 'author-id', author: { nickname: '阿明' }, content: '露营装备交流', replyCount: 0, status: 'SUSPENDED', createdAt: '2026-08-30T09:00:03.000Z', updatedAt: NOW },
    { id: 'post-2', authorId: 'author-id', author: { nickname: '阿明' }, content: '第一次露营要准备什么', replyCount: 0, status: 'ACTIVE', createdAt: '2026-08-30T09:00:02.000Z', updatedAt: NOW },
    { id: 'post-1', authorId: 'author-id', author: { nickname: '阿明' }, content: '羽毛球讨论', replyCount: 0, status: 'ACTIVE', createdAt: '2026-08-30T09:00:01.000Z', updatedAt: NOW }
  ];
  const { call } = setup({ communityPosts: posts });
  const first = await call('community.post.list', { keyword: '露营', limit: 1 });
  assert.deepEqual(first.data.items.map((item) => item.id), ['post-4']);
  assert.ok(first.data.nextCursor);
  const second = await call('community.post.list', { keyword: '露营', limit: 1, cursor: first.data.nextCursor });
  assert.deepEqual(second.data.items.map((item) => item.id), ['post-2']);
  const mismatch = await call('community.post.list', { keyword: '羽毛球', limit: 1, cursor: first.data.nextCursor });
  assert.equal(mismatch.error.code, 'VALIDATION_ERROR');
  const clearedMismatch = await call('community.post.list', { limit: 1, cursor: first.data.nextCursor });
  assert.equal(clearedMismatch.error.code, 'VALIDATION_ERROR');
  const unfiltered = await call('community.post.list', { limit: 1 });
  const addedMismatch = await call('community.post.list', { keyword: '露营', limit: 1, cursor: unfiltered.data.nextCursor });
  assert.equal(addedMismatch.error.code, 'VALIDATION_ERROR');
  const nicknameOnly = await call('community.post.list', { keyword: '露营达人' });
  assert.deepEqual(nicknameOnly.data.items, []);
  const tooLong = await call('community.post.list', { keyword: '长'.repeat(31) });
  assert.equal(tooLong.error.code, 'VALIDATION_ERROR');
  const tooLongAfterNormalization = await call('community.post.list', { keyword: '\uFB03'.repeat(11) });
  assert.equal(tooLongAfterNormalization.error.code, 'VALIDATION_ERROR');
});

test('稀疏帖子搜索以短页游标继续扫描且不会把未扫描区域误报为空', async () => {
  const base = Date.parse('2026-08-30T09:10:00.000Z');
  const posts = Array.from({ length: 502 }, (_, index) => ({
    id: `sparse-${String(502 - index).padStart(3, '0')}`,
    authorId: 'author-id',
    author: { nickname: '阿明' },
    content: index === 500 ? '深处的稀疏命中关键词' : `普通讨论 ${index}`,
    replyCount: 0,
    status: 'ACTIVE',
    createdAt: new Date(base - index * 1000).toISOString(),
    updatedAt: NOW
  }));
  const { call } = setup({ communityPosts: posts });
  const first = await call('community.post.list', { keyword: '稀疏命中', limit: 12 });
  assert.deepEqual(first.data.items, []);
  assert.ok(first.data.nextCursor);
  const second = await call('community.post.list', { keyword: '稀疏命中', limit: 12, cursor: first.data.nextCursor });
  assert.deepEqual(second.data.items.map((item) => item.content), ['深处的稀疏命中关键词']);
  assert.equal(second.data.nextCursor, null);
});

test('社区写入按用户和时间窗限流', async () => {
  const { call } = setup();
  for (let index = 0; index < 3; index += 1) {
    const result = await call('community.post.create', { content: `合规讨论内容 ${index}` }, 'author-id', `rate-post-00${index}`);
    assert.equal(result.ok, true);
  }
  const limited = await call('community.post.create', { content: '第四条合规讨论内容' }, 'author-id', 'rate-post-004');
  assert.equal(limited.error.code, 'RATE_LIMITED');
});

test('同一幂等键绑定内容，不同正文不能错误重放', async () => {
  const { call, store } = setup();
  const first = await call('community.post.create', { content: '第一条讨论内容' }, 'author-id', 'bound-payload-001');
  const conflict = await call('community.post.create', { content: '第二条不同讨论内容' }, 'author-id', 'bound-payload-001');
  assert.equal(first.ok, true);
  assert.equal(conflict.error.code, 'CONFLICT');
  assert.equal(store.communityPosts.size, 1);
});

test('Cloud 社区搜索使用复合边界和有界多批扫描而非只过滤当前页', () => {
  const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/api/lib/cloud-store.js'), 'utf8');
  const postSection = source.slice(source.indexOf('async listCommunityPosts'), source.indexOf('async getCommunityPost'));
  const replySection = source.slice(source.indexOf('async listCommunityReplies'), source.indexOf('async createCommunityPost'));
  assert.match(postSection, /this\.command\.or/);
  assert.match(postSection, /_id:\s*this\.command\.lt\(scanCursor\.id\)/);
  assert.match(postSection, /const scanLimit = 500/);
  assert.match(postSection, /while \(items\.length <= limit && scanned < scanLimit/);
  assert.match(postSection, /matchesCommunityKeyword\(candidate, keyword\)/);
  assert.match(postSection, /items\.length > limit/);
  assert.match(postSection, /encodeCursor\(continuation, keyword\)/);
  assert.match(replySection, /this\.command\.or/);
  assert.match(replySection, /_id:\s*this\.command\.gt\(cursor\.id\)/);
  assert.doesNotMatch(`${postSection}${replySection}`, /limit \+ 20/);
});

test('社区帖子和回复可进入统一举报契约', async () => {
  const { call } = setup();
  const postReport = await call('report.create', {
    targetType: 'communityPost', targetId: 'post-target', reason: 'HARASSMENT', description: ''
  }, 'other-id', 'report-community-post-001');
  const replyReport = await call('report.create', {
    targetType: 'communityReply', targetId: 'reply-target', reason: 'FRAUD_OR_DIVERSION', description: ''
  }, 'other-id', 'report-community-reply-001');
  assert.equal(postReport.ok, true);
  assert.equal(replyReport.ok, true);
});

test('Mock 社区搜索与正式契约同样只搜索正文并校验关键词', async (t) => {
  const mockServer = require('../miniprogram/mocks/server');
  mockServer.reset();
  t.after(() => mockServer.reset());
  mockServer.setPersona('u_owner');
  const created = await mockServer.call({
    action: 'community.post.create',
    requestId: 'mock-community-search-create',
    idempotencyKey: 'mock-community-search-create-001',
    data: { content: '横琴口岸出行经验补充讨论' }
  });
  assert.equal(created.ok, true);
  const matched = await mockServer.call({
    action: 'community.post.list',
    requestId: 'mock-community-search-1',
    data: { keyword: '横琴口岸', limit: 1 }
  });
  assert.equal(matched.ok, true);
  assert.equal(matched.data.items.length, 1);
  assert.ok(matched.data.nextCursor);
  const next = await mockServer.call({
    action: 'community.post.list',
    requestId: 'mock-community-search-1-next',
    data: { keyword: '横琴口岸', limit: 1, cursor: matched.data.nextCursor }
  });
  assert.equal(next.ok, true);
  assert.equal(next.data.items.length, 1);
  assert.notEqual(next.data.items[0].id, matched.data.items[0].id);
  const mismatchedChineseKeyword = await mockServer.call({
    action: 'community.post.list',
    requestId: 'mock-community-search-1-mismatch',
    data: { keyword: '横琴口岸之外', limit: 1, cursor: matched.data.nextCursor }
  });
  assert.equal(mismatchedChineseKeyword.error.code, 'VALIDATION_ERROR');
  const clearedChineseKeyword = await mockServer.call({
    action: 'community.post.list',
    requestId: 'mock-community-search-1-cleared',
    data: { limit: 1, cursor: matched.data.nextCursor }
  });
  assert.equal(clearedChineseKeyword.error.code, 'VALIDATION_ERROR');

  const replyOnly = await mockServer.call({
    action: 'community.post.list',
    requestId: 'mock-community-search-2',
    data: { keyword: '晚高峰', limit: 10 }
  });
  assert.equal(replyOnly.ok, true);
  assert.deepEqual(replyOnly.data.items, []);

  const invalid = await mockServer.call({
    action: 'community.post.list',
    requestId: 'mock-community-search-3',
    data: { keyword: '长'.repeat(31) }
  });
  assert.equal(invalid.error.code, 'VALIDATION_ERROR');
  const invalidAfterNormalization = await mockServer.call({
    action: 'community.post.list',
    requestId: 'mock-community-search-3-normalized',
    data: { keyword: '\uFB03'.repeat(11) }
  });
  assert.equal(invalidAfterNormalization.error.code, 'VALIDATION_ERROR');
  const invalidLimit = await mockServer.call({
    action: 'community.post.list',
    requestId: 'mock-community-search-4',
    data: { keyword: '横琴', limit: 1.5 }
  });
  assert.equal(invalidLimit.error.code, 'VALIDATION_ERROR');
});
