'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPinbaService } = require('../cloudfunctions/api/lib/service');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');
const mockServer = require('../miniprogram/mocks/server');
const api = require('../miniprogram/services/api');

const ROOT = path.resolve(__dirname, '..');
const profile = (nickname, avatar = null) => ({ nickname, gender: 'FEMALE', city: '澳门', interests: ['散步'], birthDate: '2000-01-01', mbti: 'INFP', adultConfirmed: true, ...(avatar ? { avatar } : {}) });

function harness() {
  let now = Date.parse('2026-09-14T08:00:00.000Z');
  let sequence = 0;
  const store = new MemoryStore({
    users: [
      { id: 'viewer', role: 'user', status: 'ACTIVE', profile: profile('访客') },
      { id: 'author', role: 'user', status: 'ACTIVE', profile: profile('作者') },
      { id: 'other', role: 'user', status: 'ACTIVE', profile: profile('其他人') }
    ],
    communityPosts: [{ id: 'post-1', authorId: 'author', author: { nickname: '旧作者' }, content: '讨论', status: 'ACTIVE', replyCount: 1, createdAt: '2026-09-14T07:00:00.000Z', updatedAt: '2026-09-14T07:00:00.000Z' }],
    communityReplies: [{ id: 'reply-1', postId: 'post-1', authorId: 'viewer', author: { nickname: '访客' }, content: '回复', status: 'ACTIVE', createdAt: '2026-09-14T07:10:00.000Z', updatedAt: '2026-09-14T07:10:00.000Z' }]
  });
  const service = createPinbaService({ store, clock: () => new Date(now), idGenerator: () => `author-nav-${++sequence}` });
  const call = (action, data, actorId, key) => service.execute({ action, data, requestId: `author-nav-request-${++sequence}`, ...(key ? { idempotencyKey: key } : {}) }, actorId ? { actorId } : {});
  return { store, call, advance: (ms) => { now += ms; } };
}

test('社区实体只在点击时签发绑定访问者的短期主页凭据且不泄漏用户标识', async () => {
  const { call } = harness();
  const issued = await call('community.profile.nav.create', { sourceType: 'post', sourceId: 'post-1' }, 'viewer', 'author-nav-post');
  assert.equal(issued.ok, true);
  assert.equal(issued.data.target, 'public');
  assert.match(issued.data.profileNavToken, /^communityProfileNa_[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(issued.data), /author|viewer|userId|openid|sourceId/);

  const opened = await call('profile.public.get', { profileNavToken: issued.data.profileNavToken }, 'viewer');
  assert.equal(opened.ok, true);
  assert.equal(opened.data.profile.nickname, '作者');
  assert.deepEqual(opened.data.profile.avatar, { kind: 'DEFAULT', fallback: 'FEMALE_DEFAULT' });
  assert.equal(opened.data.profile.online, false);
  assert.equal(opened.data.profile.viewerIsSelf, false);
  assert.doesNotMatch(JSON.stringify(opened.data), /authorId|viewerId|userId|openid|birthDate|fileID|cloudPath|revision/);

  const foreign = await call('profile.public.get', { profileNavToken: issued.data.profileNavToken }, 'other');
  assert.equal(foreign.error.code, 'NOT_FOUND');
});

test('正式水合形态经服务响应只公开HTTPS头像槽且不带底层身份与文件字段', async () => {
  const { store, call } = harness();
  store.users.get('author').profile.avatar = { status: 'ACTIVE', fileID: 'cloud://env/private-author.jpg' };
  store.hydratePublicProfileAvatar = async () => ({
    gender: 'FEMALE',
    avatarSrc: 'https://temp.example/private-author.jpg'
  });
  const issued = await call('community.profile.nav.create', { sourceType: 'post', sourceId: 'post-1' }, 'viewer', 'author-nav-cloud-shape');
  const opened = await call('profile.public.get', { profileNavToken: issued.data.profileNavToken }, 'viewer');
  assert.deepEqual(opened.data.profile.avatar, {
    kind: 'CUSTOM', src: 'https://temp.example/private-author.jpg', fallback: 'FEMALE_DEFAULT'
  });
  assert.doesNotMatch(JSON.stringify(opened.data), /cloud:\/\/|fileID|authorId|viewerId|userId|openid|birthDate/);
});

test('客户端把社区主页凭据签发识别为幂等写动作', () => {
  assert.equal(api.isMutatingAction('community.profile.nav.create'), true);
});

test('本人分流、过期票据与删除来源均安全收敛', async () => {
  const { store, call, advance } = harness();
  const self = await call('community.profile.nav.create', { sourceType: 'reply', sourceId: 'reply-1' }, 'viewer', 'author-nav-self');
  assert.deepEqual(self.data, { target: 'self' });

  const issued = await call('community.profile.nav.create', { sourceType: 'post', sourceId: 'post-1' }, 'viewer', 'author-nav-expire');
  store.communityPosts.get('post-1').status = 'DELETED';
  assert.equal((await call('profile.public.get', { profileNavToken: issued.data.profileNavToken }, 'viewer')).error.code, 'NOT_FOUND');
  assert.equal((await call('community.profile.nav.create', { sourceType: 'post', sourceId: 'post-1' }, 'viewer', 'author-nav-deleted')).error.code, 'NOT_FOUND');

  store.communityPosts.get('post-1').status = 'ACTIVE';
  const fresh = await call('community.profile.nav.create', { sourceType: 'post', sourceId: 'post-1' }, 'viewer', 'author-nav-fresh');
  advance(60_001);
  assert.equal((await call('profile.public.get', { profileNavToken: fresh.data.profileNavToken }, 'viewer')).error.code, 'NOT_FOUND');
});

test('回复票据持续复核回复、父帖、作者关系与目标账号状态', async () => {
  const cases = [
    (store) => { store.communityReplies.get('reply-1').status = 'DELETED'; },
    (store) => { store.communityPosts.get('post-1').status = 'DELETED'; },
    (store) => { store.communityReplies.get('reply-1').authorId = 'other'; },
    (store) => { store.users.get('viewer').status = 'DISABLED'; }
  ];
  for (const mutate of cases) {
    const { store, call } = harness();
    const issued = await call('community.profile.nav.create', { sourceType: 'reply', sourceId: 'reply-1' }, 'other', `reply-ticket-${cases.indexOf(mutate)}`);
    assert.equal(issued.ok, true);
    mutate(store);
    const opened = await call('profile.public.get', { profileNavToken: issued.data.profileNavToken }, 'other');
    assert.equal(opened.error.code, 'NOT_FOUND');
  }
});

test('主页票据幂等键绑定点击来源，不能跨帖子重放旧作者', async () => {
  const { store, call } = harness();
  store.communityPosts.set('post-2', { ...store.communityPosts.get('post-1'), id: 'post-2', authorId: 'other' });
  const first = await call('community.profile.nav.create', { sourceType: 'post', sourceId: 'post-1' }, 'viewer', 'same-nav-key');
  assert.equal(first.ok, true);
  const second = await call('community.profile.nav.create', { sourceType: 'post', sourceId: 'post-2' }, 'viewer', 'same-nav-key');
  assert.equal(second.ok, true);
  assert.notEqual(second.data.profileNavToken, first.data.profileNavToken);
  const opened = await call('profile.public.get', { profileNavToken: second.data.profileNavToken }, 'viewer');
  assert.equal(opened.data.profile.nickname, '其他人');
});

test('发现页与详情页作者入口使用独立 catchtap，不干扰整卡、回复和操作按钮', () => {
  const discover = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/community/index.wxml'), 'utf8');
  const detail = fs.readFileSync(path.join(ROOT, 'miniprogram/subpackages/community/detail/index.wxml'), 'utf8');
  assert.match(discover, /class="post-author-profile"[^>]+catchtap="handleAuthorProfile"[^>]+hover-stop-propagation="true"/);
  assert.match(detail, /class="author-profile"[^>]+data-source-type="post"[^>]+catchtap="handleAuthorProfile"/);
  assert.match(detail, /class="reply-author-profile"[^>]+data-source-type="reply"[^>]+catchtap="handleAuthorProfile"[^>]+hover-stop-propagation="true"/);
  assert.match(detail, /class="reply-author-profile"[\s\S]*class="reply-avatar[\s\S]*class="reply-author"/);
  assert.match(detail, /class="reply-content-target"[^>]+catchtap="handleSelectReplyTarget"/);
});

test('社区公开主页使用暖米白三卡布局并保留真实头像有限降级', () => {
  const template = fs.readFileSync(path.join(ROOT, 'miniprogram/subpackages/profile/public/index.wxml'), 'utf8');
  const style = fs.readFileSync(path.join(ROOT, 'miniprogram/subpackages/profile/public/index.wxss'), 'utf8');
  const script = fs.readFileSync(path.join(ROOT, 'miniprogram/subpackages/profile/public/index.js'), 'utf8');
  assert.match(template, /public-community-identity/);
  assert.match(template, /TA 的兴趣拼图/);
  assert.match(template, /community-public-profile-puzzle\.png/);
  assert.match(template, /wx:if="\{\{profile\.facts\.length\}\}"[\s\S]*公开资料/);
  assert.match(template, /仅展示用户主动公开的资料/);
  assert.match(template, /profile\.avatarSlot\.mode/);
  assert.match(template, /binderror="handleAvatarError"/);
  assert.match(style, /\.public-profile-page--community[\s\S]*#f9f7f2/i);
  assert.match(style, /\.public-community-card[\s\S]*border-radius:\s*36rpx/i);
  assert.match(style, /\.public-community-fact[^}]*flex:\s*0 0 auto/i);
  assert.doesNotMatch(style, /\.public-community-identity[^}]*min-height/i);
  assert.match(script, /normalizeAvatarSlots/);
  assert.match(script, /fallbackAvatarSlot/);
  assert.match(script, /setNavigationBarColor/);
  assert.doesNotMatch(template, /communitySource[^\n]*(?:正在找搭子|刚刚在线)/);
});

test('Mock 与正式接口保持本人/他人主页分流契约一致', async () => {
  mockServer.reset();
  mockServer.setPersona('u_owner');
  const other = await mockServer.call({ action: 'community.profile.nav.create', data: { sourceType: 'post', sourceId: 'community_welcome' }, requestId: 'mock-author-nav', idempotencyKey: 'mock-author-nav-key' });
  assert.equal(other.data.target, 'public');
  const opened = await mockServer.call({ action: 'profile.public.get', data: { profileNavToken: other.data.profileNavToken }, requestId: 'mock-author-open' });
  assert.equal(opened.data.profile.online, false);
  mockServer.setPersona('u_member');
  await mockServer.call({ action: 'community.post.delete', data: { postId: 'community_welcome' }, requestId: 'mock-author-delete', idempotencyKey: 'mock-author-delete-key' });
  mockServer.setPersona('u_owner');
  const removed = await mockServer.call({ action: 'profile.public.get', data: { profileNavToken: other.data.profileNavToken }, requestId: 'mock-author-removed' });
  assert.equal(removed.error.code, 'NOT_FOUND');
  mockServer.reset();
  mockServer.setPersona('u_member');
  const self = await mockServer.call({ action: 'community.profile.nav.create', data: { sourceType: 'post', sourceId: 'community_welcome' }, requestId: 'mock-author-self', idempotencyKey: 'mock-author-self-key' });
  assert.deepEqual(self.data, { target: 'self' });
});
