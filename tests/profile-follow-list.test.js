'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPinbaService } = require('../cloudfunctions/api/lib/service');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');
const { stableEntityId } = require('../cloudfunctions/api/lib/ids');
const mockServer = require('../miniprogram/mocks/server');

const ROOT = path.resolve(__dirname, '..');
const profile = (nickname, gender = 'FEMALE') => ({
  nickname,
  gender,
  city: '广州',
  interests: ['散步', '摄影'],
  birthDate: '2000-01-01',
  mbti: 'INFP',
  adultConfirmed: true
});

function follow(followerId, targetUserId, updatedAt, status = 'ACTIVE') {
  return {
    id: stableEntityId('profileFollow', followerId, targetUserId),
    followerId,
    targetUserId,
    status,
    createdAt: updatedAt,
    updatedAt,
    deletedAt: status === 'ACTIVE' ? null : updatedAt
  };
}

function harness() {
  let now = Date.parse('2026-09-19T04:00:00.000Z');
  let sequence = 0;
  const store = new MemoryStore({
    users: [
      { id: 'viewer', role: 'user', status: 'ACTIVE', profile: profile('小拼'), followingCount: 3, followerCount: 2 },
      { id: 'alice', role: 'user', status: 'ACTIVE', profile: profile('阿梨') },
      { id: 'bob', role: 'user', status: 'ACTIVE', profile: profile('阿博', 'MALE') },
      { id: 'carol', role: 'user', status: 'ACTIVE', profile: profile('小卡') },
      { id: 'disabled', role: 'user', status: 'DISABLED', profile: profile('停用用户') }
    ],
    profileFollows: [
      follow('viewer', 'alice', '2026-09-19T03:59:00.000Z'),
      follow('viewer', 'bob', '2026-09-19T03:58:00.000Z'),
      follow('viewer', 'disabled', '2026-09-19T03:57:00.000Z'),
      follow('alice', 'viewer', '2026-09-19T03:56:00.000Z'),
      follow('carol', 'viewer', '2026-09-19T03:55:00.000Z')
    ]
  });
  const service = createPinbaService({ store, clock: () => new Date(now), idGenerator: () => `follow-list-${++sequence}` });
  const call = (data, actorId = 'viewer') => service.execute({
    action: 'profile.follow.list',
    data,
    requestId: `follow-list-request-${++sequence}`
  }, actorId ? { actorId } : {});
  return { store, call, advance: (ms) => { now += ms; } };
}

test('本人关注列表分页返回公开成员且不泄露内部身份', async () => {
  const { call } = harness();
  const first = await call({ type: 'FOLLOWING', limit: 1 });
  assert.equal(first.ok, true);
  assert.equal(first.data.items.length, 1);
  assert.equal(first.data.items[0].nickname, '阿梨');
  assert.equal(first.data.items[0].viewerFollowing, true);
  assert.equal(first.data.items[0].mutual, true);
  assert.match(first.data.items[0].profileNavToken, /^socialProfileNa_[a-f0-9]{64}$/);
  assert.match(first.data.nextCursor, /^profileFollowPage_[a-f0-9]{64}$/);
  assert.equal(first.data.hasMore, true);
  assert.deepEqual(first.data.summary, { followingCount: 3, followerCount: 2 });
  assert.doesNotMatch(JSON.stringify(first.data), /"(?:userId|openid|followerId|targetUserId|followId|relationId)"/);

  const second = await call({ type: 'FOLLOWING', limit: 1, cursor: first.data.nextCursor });
  assert.equal(second.data.items.length, 1);
  assert.equal(second.data.items[0].nickname, '阿博');
  assert.equal(second.data.items[0].mutual, false);
  assert.notEqual(second.data.items[0].memberKey, first.data.items[0].memberKey);
  assert.equal(second.data.items.some((item) => item.nickname === '停用用户'), false);
});

test('粉丝列表区分关注了你与互相关注，短期主页票据可安全打开', async () => {
  const { store, call } = harness();
  const result = await call({ type: 'FOLLOWERS', limit: 20 });
  assert.equal(result.ok, true);
  assert.equal(result.data.items.length, 2);
  const alice = result.data.items.find((item) => item.nickname === '阿梨');
  const carol = result.data.items.find((item) => item.nickname === '小卡');
  assert.equal(alice.viewerFollowing, true);
  assert.equal(alice.mutual, true);
  assert.equal(carol.viewerFollowing, false);
  assert.equal(carol.mutual, false);

  let sequence = 0;
  const service = createPinbaService({ store, clock: () => new Date('2026-09-19T04:00:01.000Z'), idGenerator: () => `open-${++sequence}` });
  const opened = await service.execute({
    action: 'profile.public.get',
    data: { profileNavToken: alice.profileNavToken },
    requestId: 'open-social-profile'
  }, { actorId: 'viewer' });
  assert.equal(opened.ok, true);
  assert.equal(opened.data.profile.nickname, '阿梨');
  assert.equal(opened.data.profile.online, false);
});

test('列表跨过密集失效关系后仍在同一页返回后续有效成员', async () => {
  const disabledUsers = Array.from({ length: 25 }, (_, index) => ({
    id: `disabled-${index}`,
    role: 'user',
    status: 'DISABLED',
    profile: profile(`停用${index}`)
  }));
  const relations = disabledUsers.map((user, index) => follow(
    'viewer',
    user.id,
    `2026-09-19T03:${String(59 - index).padStart(2, '0')}:30.000Z`
  ));
  relations.push(follow('viewer', 'visible', '2026-09-19T03:20:00.000Z'));
  const store = new MemoryStore({
    users: [
      { id: 'viewer', role: 'user', status: 'ACTIVE', profile: profile('小拼'), followingCount: 26, followerCount: 0 },
      ...disabledUsers,
      { id: 'visible', role: 'user', status: 'ACTIVE', profile: profile('最后可见') }
    ],
    profileFollows: relations
  });
  let sequence = 0;
  const service = createPinbaService({ store, clock: () => new Date('2026-09-19T04:00:00.000Z'), idGenerator: () => `sparse-${++sequence}` });
  const result = await service.execute({
    action: 'profile.follow.list',
    data: { type: 'FOLLOWING', limit: 1 },
    requestId: 'sparse-follow-page'
  }, { actorId: 'viewer' });
  assert.equal(result.ok, true);
  assert.equal(result.data.items.length, 1);
  assert.equal(result.data.items[0].nickname, '最后可见');
  assert.equal(result.data.hasMore, false);
});

test('关系列表拒绝越权参数、跨 Tab/跨账号游标和过期凭据', async () => {
  const { call, advance } = harness();
  assert.equal((await call({ type: 'FOLLOWING', userId: 'alice' })).error.code, 'VALIDATION_ERROR');
  assert.equal((await call({ type: 'UNKNOWN' })).error.code, 'VALIDATION_ERROR');
  assert.equal((await call({ type: 'FOLLOWING' }, null)).error.code, 'UNAUTHENTICATED');

  const first = await call({ type: 'FOLLOWING', limit: 1 });
  assert.equal((await call({ type: 'FOLLOWERS', limit: 1, cursor: first.data.nextCursor })).error.code, 'VALIDATION_ERROR');
  assert.equal((await call({ type: 'FOLLOWING', limit: 1, cursor: first.data.nextCursor }, 'alice')).error.code, 'VALIDATION_ERROR');
  advance(10 * 60 * 1000 + 1);
  assert.equal((await call({ type: 'FOLLOWING', limit: 1, cursor: first.data.nextCursor })).error.code, 'VALIDATION_ERROR');
});

test('Mock 关系列表与正式契约同构并签发社交主页凭据', async () => {
  mockServer.reset();
  mockServer.setPersona('u_owner');
  const nav = await mockServer.call({
    action: 'community.profile.nav.create',
    data: { sourceType: 'post', sourceId: 'community_welcome' },
    requestId: 'mock-follow-list-nav',
    idempotencyKey: 'mock-follow-list-nav-key'
  });
  await mockServer.call({
    action: 'profile.follow.set',
    data: { profileNavToken: nav.data.profileNavToken, following: true },
    requestId: 'mock-follow-list-set',
    idempotencyKey: 'mock-follow-list-set-key'
  });
  const listed = await mockServer.call({
    action: 'profile.follow.list',
    data: { type: 'FOLLOWING', limit: 20 },
    requestId: 'mock-follow-list'
  });
  assert.equal(listed.ok, true);
  assert.equal(listed.data.items.length, 1);
  assert.match(listed.data.items[0].profileNavToken, /^socialProfileNa_[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(listed.data), /"(?:userId|openid|followerId|targetUserId|followId)"/);
});

test('Cloud 关系列表使用两条受控复合查询且关注写事务仍不使用 where', () => {
  const source = fs.readFileSync(path.join(ROOT, 'cloudfunctions/api/lib/cloud-store.js'), 'utf8');
  const listSection = source.slice(source.indexOf('async listProfileFollows'), source.indexOf('async getProfileFollowStates'));
  assert.match(listSection, /collection\('profileFollows'\)/);
  assert.match(listSection, /orderBy\('updatedAt', 'desc'\)/);
  assert.match(listSection, /orderBy\('_id', 'desc'\)/);
  assert.match(listSection, /followerId/);
  assert.match(listSection, /targetUserId/);
  const writeSection = source.slice(source.indexOf('async setProfileFollowAtomic'), source.indexOf('async listNotifications'));
  assert.doesNotMatch(writeSection, /\.where\(/);
});
