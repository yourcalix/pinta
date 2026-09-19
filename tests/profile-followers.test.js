'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPinbaService } = require('../cloudfunctions/api/lib/service');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');
const { createCommunityProfileNavTicket } = require('../cloudfunctions/api/lib/community-profile-navigation');
const api = require('../miniprogram/services/api');
const mockServer = require('../miniprogram/mocks/server');

const ROOT = path.resolve(__dirname, '..');
const profile = (nickname) => ({
  nickname,
  gender: 'FEMALE',
  city: '澳门',
  interests: ['散步'],
  birthDate: '2000-01-01',
  mbti: 'INFP',
  adultConfirmed: true
});

function harness() {
  let sequence = 0;
  let now = Date.parse('2026-09-16T02:00:00.000Z');
  const store = new MemoryStore({
    users: [
      { id: 'viewer', role: 'user', status: 'ACTIVE', profile: profile('访客') },
      { id: 'author', role: 'user', status: 'ACTIVE', profile: profile('作者') },
      { id: 'other', role: 'user', status: 'ACTIVE', profile: profile('其他人') }
    ],
    communityPosts: [
      { id: 'post-author', authorId: 'author', author: { nickname: '作者' }, content: '讨论', status: 'ACTIVE', replyCount: 0, createdAt: '2026-09-16T01:00:00.000Z', updatedAt: '2026-09-16T01:00:00.000Z' },
      { id: 'post-viewer', authorId: 'viewer', author: { nickname: '访客' }, content: '自己的讨论', status: 'ACTIVE', replyCount: 0, createdAt: '2026-09-16T01:05:00.000Z', updatedAt: '2026-09-16T01:05:00.000Z' }
    ]
  });
  const service = createPinbaService({ store, clock: () => new Date(now), idGenerator: () => `follow-${++sequence}` });
  const call = (action, data, actorId = 'viewer', key = `follow-key-${++sequence}`) => service.execute({
    action,
    data,
    requestId: `follow-request-${++sequence}`,
    ...(key ? { idempotencyKey: key } : {})
  }, actorId ? { actorId } : {});
  const issue = (sourceId = 'post-author', actorId = 'viewer') => call('community.profile.nav.create', { sourceType: 'post', sourceId }, actorId);
  return { store, call, issue, advance: (ms) => { now += ms; }, now: () => new Date(now).toISOString() };
}

test('关注与取消关注按确定性关系幂等更新双方计数', async () => {
  const { store, call, issue } = harness();
  const nav = await issue();
  const token = nav.data.profileNavToken;

  const first = await call('profile.follow.set', { profileNavToken: token, following: true });
  assert.deepEqual(first.data, {
    following: true,
    followerCount: 1,
    followingCount: 1,
    serverNow: '2026-09-16T02:00:00.000Z'
  });
  const repeated = await call('profile.follow.set', { profileNavToken: token, following: true });
  assert.equal(repeated.data.followerCount, 1);
  assert.equal(repeated.data.followingCount, 1);
  assert.equal(store.profileFollows.size, 1);

  const opened = await call('profile.public.get', { profileNavToken: token }, 'viewer', '');
  assert.equal(opened.data.profile.viewerFollowing, true);
  assert.equal(opened.data.profile.followerCount, 1);
  assert.equal(opened.data.profile.followingCount, 0);
  assert.doesNotMatch(JSON.stringify(opened.data), /authorId|viewerId|targetUserId|followerId|openid/);

  const mine = await call('profile.get', {}, 'viewer', '');
  assert.equal(mine.data.user.followingCount, 1);
  assert.equal(mine.data.user.followerCount, 0);

  const removed = await call('profile.follow.set', { profileNavToken: token, following: false });
  assert.equal(removed.data.following, false);
  assert.equal(removed.data.followerCount, 0);
  assert.equal(removed.data.followingCount, 0);
  const repeatedRemoval = await call('profile.follow.set', { profileNavToken: token, following: false });
  assert.equal(repeatedRemoval.data.followerCount, 0);
  assert.equal(repeatedRemoval.data.followingCount, 0);
});

test('并发重复关注只增加一次且不同查看者关系彼此隔离', async () => {
  const { store, call, issue } = harness();
  const viewerNav = await issue('post-author', 'viewer');
  const otherNav = await issue('post-author', 'other');
  await Promise.all([
    call('profile.follow.set', { profileNavToken: viewerNav.data.profileNavToken, following: true }, 'viewer'),
    call('profile.follow.set', { profileNavToken: viewerNav.data.profileNavToken, following: true }, 'viewer'),
    call('profile.follow.set', { profileNavToken: otherNav.data.profileNavToken, following: true }, 'other')
  ]);
  assert.equal(store.users.get('author').followerCount, 2);
  assert.equal(store.users.get('viewer').followingCount, 1);
  assert.equal(store.users.get('other').followingCount, 1);
  assert.equal([...store.profileFollows.values()].filter((item) => item.status === 'ACTIVE').length, 2);
});

test('自关注、越权、过期、来源失效与禁用目标全部拒绝且不改计数', async () => {
  const { store, call, issue, advance, now } = harness();
  const selfTicket = createCommunityProfileNavTicket({
    viewerId: 'viewer',
    targetUserId: 'viewer',
    sourceType: 'post',
    sourceId: 'post-viewer',
    at: now(),
    randomBytes: () => Buffer.alloc(32, 7)
  });
  await store.createPublicProfileNavTicket(selfTicket.ticket);
  assert.equal((await call('profile.follow.set', { profileNavToken: selfTicket.profileNavToken, following: true })).error.code, 'FORBIDDEN');

  const foreign = await issue();
  assert.equal((await call('profile.follow.set', { profileNavToken: foreign.data.profileNavToken, following: true }, 'other')).error.code, 'NOT_FOUND');

  const expired = await issue();
  advance(60_001);
  assert.equal((await call('profile.follow.set', { profileNavToken: expired.data.profileNavToken, following: true })).error.code, 'NOT_FOUND');

  const sourceGone = harness();
  const sourceNav = await sourceGone.issue();
  sourceGone.store.communityPosts.get('post-author').status = 'DELETED';
  assert.equal((await sourceGone.call('profile.follow.set', { profileNavToken: sourceNav.data.profileNavToken, following: true })).error.code, 'NOT_FOUND');

  const disabled = harness();
  const disabledNav = await disabled.issue();
  disabled.store.users.get('author').status = 'DISABLED';
  assert.equal((await disabled.call('profile.follow.set', { profileNavToken: disabledNav.data.profileNavToken, following: true })).error.code, 'NOT_FOUND');

  assert.equal(store.users.get('viewer').followingCount || 0, 0);
  assert.equal(store.users.get('author').followerCount || 0, 0);
});

test('关注动作被正式客户端识别为业务写操作', () => {
  assert.equal(api.isMutatingAction('profile.follow.set'), true);
});

test('搭子目录凭据可以关注且旧在线快照的非绑定凭据只允许读取', async () => {
  const { call } = harness();
  const directory = await call('companion.directory.snapshot', { scene: 'companion_globe' }, 'viewer', '');
  const node = directory.data.users.find((item) => !item.viewerIsSelf);
  const nav = await call('companion.directory.profile.nav.create', { scene: 'companion_globe', displayToken: node.displayToken }, 'viewer');
  const followed = await call('profile.follow.set', { profileNavToken: nav.data.profileNavToken, following: true }, 'viewer');
  assert.equal(followed.ok, true);
  assert.equal(followed.data.following, true);

  await call('companion.presence.enter', { scene: 'companion_globe' }, 'author');
  const presence = await call('companion.presence.snapshot', { scene: 'companion_globe' }, 'viewer', '');
  const legacyToken = presence.data.users[0].profileNavToken;
  assert.equal((await call('profile.public.get', { profileNavToken: legacyToken }, 'viewer', '')).ok, true);
  assert.equal((await call('profile.follow.set', { profileNavToken: legacyToken, following: true }, 'viewer')).error.code, 'NOT_FOUND');
});

test('Mock 服务与正式关注契约一致', async () => {
  mockServer.reset();
  mockServer.setPersona('u_owner');
  const nav = await mockServer.call({
    action: 'community.profile.nav.create',
    data: { sourceType: 'post', sourceId: 'community_welcome' },
    requestId: 'mock-follow-nav',
    idempotencyKey: 'mock-follow-nav-key'
  });
  const followed = await mockServer.call({
    action: 'profile.follow.set',
    data: { profileNavToken: nav.data.profileNavToken, following: true },
    requestId: 'mock-follow-set',
    idempotencyKey: 'mock-follow-set-key'
  });
  assert.equal(followed.data.following, true);
  assert.equal(followed.data.followerCount, 1);
  const opened = await mockServer.call({ action: 'profile.public.get', data: { profileNavToken: nav.data.profileNavToken }, requestId: 'mock-follow-open' });
  assert.equal(opened.data.profile.viewerFollowing, true);
  assert.equal(opened.data.profile.followerCount, 1);
});

test('Cloud Store 把关系、双方计数和审计放在同一事务', () => {
  const cloudStore = fs.readFileSync(path.join(ROOT, 'cloudfunctions/api/lib/cloud-store.js'), 'utf8');
  const section = cloudStore.slice(cloudStore.indexOf('async setProfileFollowAtomic'), cloudStore.indexOf('async listNotifications'));
  assert.match(section, /runTransaction/);
  assert.match(section, /collection\('profileFollows'\)/);
  assert.match(section, /followingCount/);
  assert.match(section, /followerCount/);
  assert.match(section, /collection\('auditLogs'\)/);
  assert.doesNotMatch(section, /Promise\.all/);
  assert.match(section, /const follower = await getTransactionDocument\(followerReference\);[\s\S]+const target = await getTransactionDocument\(targetReference\);/);
});

test('公开主页两套主题与我的主页展示真实社交指标并提供列表入口', () => {
  const publicTemplate = fs.readFileSync(path.join(ROOT, 'miniprogram/subpackages/profile/public/index.wxml'), 'utf8');
  const publicStyle = fs.readFileSync(path.join(ROOT, 'miniprogram/subpackages/profile/public/index.wxss'), 'utf8');
  const publicScript = fs.readFileSync(path.join(ROOT, 'miniprogram/subpackages/profile/public/index.js'), 'utf8');
  const selfTemplate = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/user/index.wxml'), 'utf8');

  assert.match(publicTemplate, /public-community-social-stats/);
  assert.match(publicTemplate, /public-social-stats/);
  assert.match(publicTemplate, /bindtap="handleToggleFollow"/);
  assert.match(publicTemplate, /wx:if="\{\{!profile\.viewerIsSelf\}\}"/);
  assert.doesNotMatch(publicTemplate, /(?:public-community-social-stats|public-social-stats)[^>]+bindtap=/);
  assert.match(publicStyle, /font-variant-numeric:\s*tabular-nums/);
  assert.match(publicStyle, /min-height:\s*88rpx/);
  assert.match(publicScript, /_followPending/);
  assert.match(publicScript, /Math\.max\(0,/);
  assert.match(selfTemplate, /profile-social-overview/);
  assert.match(selfTemplate, /profile-social-overview-item[^>]+bindtap="handleSocialListTap"/);
});
