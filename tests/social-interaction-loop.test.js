'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPinbaService } = require('../cloudfunctions/api/lib/service');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');
const mockServer = require('../miniprogram/mocks/server');
const communityService = require('../miniprogram/services/community');
const userService = require('../miniprogram/services/user');

const NOW = '2026-09-04T03:00:00.000Z';
const user = (id) => ({ id, role: 'user', status: 'ACTIVE', profile: { nickname: id, gender: 'MALE', city: '澳门', interests: [], adultConfirmed: true }, createdAt: NOW, updatedAt: NOW });
function setup() {
  const post = { id: 'post', authorId: 'author', author: { nickname: '作者', avatarKind: 'PASSENGER_A' }, content: '讨论', replyCount: 1, likeCount: 0, status: 'ACTIVE', createdAt: NOW, updatedAt: NOW };
  const reply = { id: 'reply', postId: 'post', authorId: 'other', author: { nickname: '回复者', avatarKind: 'PASSENGER_B' }, content: '回复', likeCount: 0, status: 'ACTIVE', createdAt: NOW, updatedAt: NOW };
  const store = new MemoryStore({ users: [user('author'), user('other')], communityPosts: [post], communityReplies: [reply] });
  let n = 0;
  const service = createPinbaService({ store, clock: () => new Date(NOW), idGenerator: () => `id-${++n}` });
  const call = (action, data, actorId, key = `interaction-key-${++n}`) => service.execute({ action, data, requestId: `r-${n}`, idempotencyKey: key }, actorId ? { actorId } : {});
  return { store, call };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function loadDetailPage() {
  let definition;
  global.Page = (value) => { definition = value; };
  global.wx = { hideKeyboard() {}, navigateTo() {}, showToast() {}, switchTab() {}, vibrateShort() {} };
  const pagePath = require.resolve('../miniprogram/subpackages/community/detail/index');
  delete require.cache[pagePath];
  require(pagePath);
  const page = {
    ...definition,
    data: { ...definition.data },
    setData(value) { Object.assign(this.data, value); }
  };
  return { page, pagePath };
}

function unloadDetailPage(context) {
  delete require.cache[context.pagePath];
  delete global.Page;
  delete global.wx;
}

test('帖子与回复点赞可Toggle且重复请求不重复计数', async () => {
  const { store, call } = setup();
  const liked = await call('community.like.set', { targetType: 'post', targetId: 'post', liked: true }, 'other');
  assert.equal(liked.data.likeCount, 1);
  const repeated = await call('community.like.set', { targetType: 'post', targetId: 'post', liked: true }, 'other');
  assert.equal(repeated.data.likeCount, 1);
  const reply = await call('community.like.set', { targetType: 'reply', targetId: 'reply', liked: true }, 'author');
  assert.equal(reply.data.likeCount, 1);
  const unliked = await call('community.like.set', { targetType: 'post', targetId: 'post', liked: false }, 'other');
  assert.equal(unliked.data.likeCount, 0);
  assert.equal(store.communityLikes.size, 2);
});

test('点赞设置由业务状态幂等，同一请求键仍可切换到新状态', async () => {
  const { call } = setup();
  const key = 'same-like-setting-key';
  const liked = await call('community.like.set', { targetType: 'post', targetId: 'post', liked: true }, 'other', key);
  const unliked = await call('community.like.set', { targetType: 'post', targetId: 'post', liked: false }, 'other', key);
  assert.equal(liked.data.liked, true);
  assert.equal(unliked.data.liked, false);
  assert.equal(unliked.data.likeCount, 0);

  mockServer.reset();
  mockServer.setPersona('u_owner');
  const mockLiked = await mockServer.call({ action: 'community.like.set', data: { targetType: 'post', targetId: 'community_welcome', liked: true }, requestId: 'mock-like-on', idempotencyKey: key });
  const mockUnliked = await mockServer.call({ action: 'community.like.set', data: { targetType: 'post', targetId: 'community_welcome', liked: false }, requestId: 'mock-like-off', idempotencyKey: key });
  assert.equal(mockLiked.data.liked, true);
  assert.equal(mockUnliked.data.liked, false);
  assert.equal(mockUnliked.data.likeCount, 0);
  mockServer.reset();
});

test('详情DTO包含点赞计数和当前用户状态，游客状态为false', async () => {
  const { call } = setup();
  await call('community.like.set', { targetType: 'post', targetId: 'post', liked: true }, 'other');
  const memberList = await call('community.post.list', { limit: 20 }, 'other');
  assert.equal(memberList.data.items[0].viewerHasLiked, true);
  assert.equal(memberList.data.items[0].likeCount, 1);
  const member = await call('community.post.detail', { postId: 'post', limit: 30 }, 'other');
  assert.equal(member.data.post.viewerHasLiked, true);
  assert.equal(member.data.post.likeCount, 1);
  assert.equal(member.data.replies[0].viewerHasLiked, false);
  const guest = await call('community.post.detail', { postId: 'post', limit: 30 });
  assert.equal(guest.data.post.viewerHasLiked, false);
  const guestList = await call('community.post.list', { limit: 20 });
  assert.equal(guestList.data.items[0].viewerHasLiked, false);
});

test('Mock 与真实服务对非法点赞目标ID保持校验错误一致', async () => {
  mockServer.reset();
  mockServer.setPersona('u_owner');
  const result = await mockServer.call({
    action: 'community.like.set',
    data: { targetType: 'post', targetId: '', liked: true },
    requestId: 'mock-invalid-like-target',
    idempotencyKey: 'mock-invalid-like-target-key'
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'VALIDATION_ERROR');
  mockServer.reset();
});

test('删除目标不能点赞，未登录或资料不完整不能点赞', async () => {
  const { store, call } = setup();
  store.communityPosts.get('post').status = 'DELETED';
  assert.equal((await call('community.like.set', { targetType: 'post', targetId: 'post', liked: true }, 'other')).error.code, 'NOT_FOUND');
  assert.equal((await call('community.like.set', { targetType: 'reply', targetId: 'reply', liked: true })).error.code, 'UNAUTHENTICATED');
});

test('前端呈现双计数、友好时间、单字头像、评论续页与独立点赞锁，社区无陌生人私信', () => {
  const root = path.join(__dirname, '../miniprogram');
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const list = read('pages/community/index.wxml');
  const detail = read('subpackages/community/detail/index.wxml');
  const script = read('subpackages/community/detail/index.js');
  assert.match(list, /item\.likeCount/);
  assert.match(detail, /displayTime/);
  assert.match(detail, /avatarInitial/);
  assert.doesNotMatch(detail, /avatarPath|<image[^>]*reply-avatar/);
  assert.match(detail, /handleLike/);
  assert.match(detail, /handleRetryLoadMore/);
  assert.match(detail, /handleRetryDetail/);
  assert.match(script, /likingMap/);
  assert.match(script, /nextCursor/);
  assert.match(script, /new Map/);
  assert.doesNotMatch(`${list}${detail}`, /私信TA|发私信/);
});

test('点赞鉴权在途时同一目标只允许一个请求，卸载后不再setData', async () => {
  const originalLogin = userService.login;
  const originalSetLike = communityService.setLike;
  const access = deferred();
  const response = deferred();
  let calls = 0;
  userService.login = () => access.promise;
  communityService.setLike = () => { calls += 1; return response.promise; };
  const context = loadDetailPage();
  try {
    context.page.setData({ postId: 'post', post: { id: 'post', likeCount: 0, viewerHasLiked: false }, likingMap: {} });
    const event = { currentTarget: { dataset: { targetType: 'post', targetId: 'post' } } };
    const first = context.page.handleLike(event);
    const second = context.page.handleLike(event);
    access.resolve({ profileComplete: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);

    let destroyedSetDataCalls = 0;
    const originalSetData = context.page.setData;
    context.page.onUnload();
    context.page.setData = function setDataAfterUnload(value) {
      destroyedSetDataCalls += 1;
      originalSetData.call(this, value);
    };
    response.resolve({ liked: true, likeCount: 1 });
    await Promise.all([first, second]);
    assert.equal(destroyedSetDataCalls, 0);
  } finally {
    userService.login = originalLogin;
    communityService.setLike = originalSetLike;
    unloadDetailPage(context);
  }
});

test('评论续页只合并回复，不覆盖主帖正在进行的点赞状态', async () => {
  const originalGetPost = communityService.getPost;
  communityService.getPost = async () => ({
    post: { id: 'post', likeCount: 0, viewerHasLiked: false, createdAt: NOW, author: { nickname: '作者' } },
    replies: [{ id: 'reply-2', createdAt: NOW, author: { nickname: '回复者' }, content: '续页' }],
    nextCursor: null
  });
  const context = loadDetailPage();
  try {
    const currentPost = { id: 'post', likeCount: 1, viewerHasLiked: true, likePending: true };
    context.page._loadSeq = 1;
    context.page.setData({ postId: 'post', post: currentPost, replies: [], nextCursor: 'next', hasMore: true });
    await context.page.loadDetail(true);
    assert.equal(context.page.data.post, currentPost);
    assert.deepEqual(context.page.data.replies.map((item) => item.id), ['reply-2']);
  } finally {
    communityService.getPost = originalGetPost;
    unloadDetailPage(context);
  }
});
