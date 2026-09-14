'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPinbaService } = require('../cloudfunctions/api/lib/service');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');
const { CloudStore } = require('../cloudfunctions/api/lib/cloud-store');
const mockServer = require('../miniprogram/mocks/server');
const { normalizeAvatarSlots, fallbackAvatarSlot } = require('../miniprogram/utils/passenger-avatar');

const NOW = '2026-09-12T12:00:00.000Z';

function communityUser(id, gender, fileID, status = 'ACTIVE') {
  return {
    id,
    role: 'user',
    status,
    profile: {
      nickname: id,
      gender,
      city: '澳门',
      interests: [],
      adultConfirmed: true,
      ...(fileID ? { avatar: { status: 'ACTIVE', fileID, revision: 3, cloudPath: 'private/path.jpg' } } : {})
    },
    createdAt: NOW,
    updatedAt: NOW
  };
}

function serviceHarness() {
  const store = new MemoryStore({
    users: [
      communityUser('post-author', 'MALE', 'https://cdn.example/post-current.jpg'),
      communityUser('reply-author', 'FEMALE', 'https://cdn.example/reply-current.jpg')
    ],
    communityPosts: [{
      id: 'post-1', authorId: 'post-author', author: { nickname: '帖子作者', avatarKind: 'PASSENGER_A' },
      content: '头像测试讨论', replyCount: 1, status: 'ACTIVE', createdAt: NOW, updatedAt: NOW
    }],
    communityReplies: [{
      id: 'reply-1', postId: 'post-1', authorId: 'reply-author', author: { nickname: '回复作者', avatarKind: 'PASSENGER_B' },
      content: '头像测试回复', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW
    }]
  });
  let sequence = 0;
  const service = createPinbaService({ store, clock: () => new Date(NOW), idGenerator: () => `community-avatar-${++sequence}` });
  const call = (action, data = {}, actorId = null, key) => service.execute({
    action, data, requestId: `community-avatar-request-${++sequence}`, ...(key ? { idempotencyKey: key } : {})
  }, actorId ? { actorId } : {});
  return { store, call };
}

test('社区列表与详情按作者当前资料水合头像且公开DTO保持脱敏', async () => {
  const { store, call } = serviceHarness();
  const listed = await call('community.post.list', { limit: 20 });
  assert.deepEqual(listed.data.items[0].author.avatar, {
    kind: 'CUSTOM', src: 'https://cdn.example/post-current.jpg', fallback: 'MALE_DEFAULT'
  });

  store.users.get('post-author').profile.avatar.fileID = 'https://cdn.example/post-new.jpg';
  const detail = await call('community.post.detail', { postId: 'post-1', limit: 30 });
  assert.equal(detail.data.post.author.avatar.src, 'https://cdn.example/post-new.jpg');
  assert.deepEqual(detail.data.replies[0].author.avatar, {
    kind: 'CUSTOM', src: 'https://cdn.example/reply-current.jpg', fallback: 'FEMALE_DEFAULT'
  });
  const serialized = JSON.stringify(detail.data);
  assert.doesNotMatch(serialized, /post-author|reply-author|fileID|cloudPath|uploadId|revision|cloud:\/\//);
});

test('社区创建返回当前头像，原始云地址与停用账号只安全降级', async () => {
  const { store, call } = serviceHarness();
  store.users.get('post-author').profile.avatar.fileID = 'cloud://env/private-post.jpg';
  const created = await call('community.post.create', { content: '新建讨论也应返回安全头像' }, 'post-author', 'create-current-avatar');
  assert.deepEqual(created.data.post.author.avatar, { kind: 'DEFAULT', fallback: 'MALE_DEFAULT' });
  assert.doesNotMatch(JSON.stringify(created.data), /cloud:\/\//);

  store.users.get('reply-author').status = 'DISABLED';
  const detail = await call('community.post.detail', { postId: 'post-1', limit: 30 });
  assert.deepEqual(detail.data.replies[0].author.avatar, { kind: 'DEFAULT', fallback: 'FEMALE_DEFAULT' });
  assert.doesNotMatch(JSON.stringify(detail.data), /reply-current/);
});

test('社区创建幂等重放重新水合当前头像而不复用旧展示地址', async () => {
  const { store, call } = serviceHarness();
  const input = { content: '幂等重放也应使用当前账号头像' };
  const first = await call('community.post.create', input, 'post-author', 'community-avatar-replay');
  assert.equal(first.data.post.author.avatar.src, 'https://cdn.example/post-current.jpg');
  store.users.get('post-author').profile.avatar.fileID = 'https://cdn.example/post-after-replay.jpg';
  const replay = await call('community.post.create', input, 'post-author', 'community-avatar-replay');
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.data.post.author.avatar.src, 'https://cdn.example/post-after-replay.jpg');
});

function cloudHarness(count = 11) {
  const users = Array.from({ length: count }, (_, index) => ({
    _id: `author-${index}`,
    status: 'ACTIVE',
    profile: {
      gender: index % 2 ? 'FEMALE' : 'MALE',
      avatar: index === 0 ? { status: 'ACTIVE', fileID: 'cloud://env/current.jpg' } : null
    }
  }));
  const queryChunks = [];
  const command = { in: (values) => ({ $in: values }) };
  const database = {
    command,
    collection(name) {
      let where = {};
      let size = 20;
      const query = {
        where(value) { where = value; return query; },
        limit(value) { size = value; return query; },
        async get() {
          Object.values(where).forEach((value) => { if (value && value.$in) queryChunks.push(value.$in.length); });
          return { data: users.filter((user) => !where._id || where._id.$in.includes(user._id)).slice(0, size).map(structuredClone) };
        }
      };
      assert.equal(name, 'users');
      return query;
    }
  };
  const cloud = {
    database: () => database,
    async getTempFileURL({ fileList }) {
      return { fileList: fileList.map((fileID) => ({ fileID, status: 0, tempFileURL: 'https://temp.example/current.jpg' })) };
    }
  };
  return { store: new CloudStore(cloud), queryChunks };
}

test('Cloud社区作者按十条分片水合且只生成HTTPS展示地址', async () => {
  const { store, queryChunks } = cloudHarness();
  const items = Array.from({ length: 11 }, (_, index) => ({ authorId: `author-${index}` }));
  const hydration = await store.hydratePublicCommunityAuthors(items);
  assert.deepEqual(queryChunks, [10, 1]);
  assert.deepEqual(hydration.profilesByUserId['author-0'], {
    gender: 'MALE', avatarSrc: 'https://temp.example/current.jpg'
  });
  assert.doesNotMatch(JSON.stringify(hydration), /cloud:\/\//);
});

test('Cloud社区头像临时地址签发失败时保留默认头像事实且不抛错', async () => {
  const { store } = cloudHarness(1);
  store.cloud.getTempFileURL = async () => { throw Object.assign(new Error('private provider details'), { errCode: -1 }); };
  const originalError = console.error;
  console.error = () => {};
  try {
    const hydration = await store.hydratePublicCommunityAuthors([{ authorId: 'author-0' }]);
    assert.deepEqual(hydration.profilesByUserId['author-0'], { gender: 'MALE', avatarSrc: '' });
    assert.doesNotMatch(JSON.stringify(hydration), /cloud:\/\/|private provider details/);
  } finally {
    console.error = originalError;
  }
});

test('Cloud公开主页头像仅签发HTTPS展示地址且失败时不泄露fileID', async () => {
  const { store } = cloudHarness(1);
  const target = communityUser('author-0', 'MALE', 'cloud://env/current.jpg');
  const hydrated = await store.hydratePublicProfileAvatar(target);
  assert.deepEqual(hydrated, { gender: 'MALE', avatarSrc: 'https://temp.example/current.jpg' });
  assert.doesNotMatch(JSON.stringify(hydrated), /cloud:\/\//);

  const historical = await store.hydratePublicProfileAvatar(communityUser('author-0', 'MALE', 'https://raw.example/not-cloud-storage.jpg'));
  assert.deepEqual(historical, { gender: 'MALE', avatarSrc: '' });

  store.cloud.getTempFileURL = async () => { throw new Error('provider details'); };
  const originalError = console.error;
  console.error = () => {};
  try {
    const fallback = await store.hydratePublicProfileAvatar(target);
    assert.deepEqual(fallback, { gender: 'MALE', avatarSrc: '' });
    assert.doesNotMatch(JSON.stringify(fallback), /cloud:\/\/|provider details/);
  } finally {
    console.error = originalError;
  }
});

test('Mock社区允许本地展示路径且最终公开头像槽与正式DTO字段同构', async () => {
  mockServer.reset();
  mockServer.setPersona('u_member');
  const prepared = await mockServer.call({ action: 'profile.avatar.prepare', data: {}, requestId: 'mock-avatar-prepare', idempotencyKey: 'mock-avatar-prepare-key' });
  await mockServer.call({
    action: 'profile.avatar.confirm',
    data: { uploadId: prepared.data.upload.id, fileID: 'wxfile://tmp/community-avatar.jpg' },
    requestId: 'mock-avatar-confirm',
    idempotencyKey: 'mock-avatar-confirm-key'
  });
  const listed = await mockServer.call({ action: 'community.post.list', data: { limit: 20 }, requestId: 'mock-avatar-list' });
  assert.deepEqual(listed.data.items[0].author.avatar, {
    kind: 'CUSTOM', src: 'wxfile://tmp/community-avatar.jpg', fallback: 'FEMALE_DEFAULT'
  });
  assert.doesNotMatch(JSON.stringify(listed.data), /u_member|fileID|revision/);
  mockServer.reset();
});

test('前端社区头像只接受展示白名单并执行有限两级回退', () => {
  const custom = normalizeAvatarSlots([{ kind: 'CUSTOM', src: 'https://cdn.example/avatar.jpg', fallback: 'FEMALE_DEFAULT' }], 1)[0];
  assert.equal(custom.kind, 'CUSTOM');
  const fallback = fallbackAvatarSlot(custom);
  assert.equal(fallback.kind, 'DEFAULT');
  assert.match(fallback.src, /profile-avatar-female-painted\.png$/);
  assert.equal(fallbackAvatarSlot(fallback), fallback);

  const privateSource = normalizeAvatarSlots([{ kind: 'CUSTOM', src: 'cloud://env/private.jpg', fallback: 'MALE_DEFAULT' }], 1)[0];
  assert.equal(privateSource.kind, 'DEFAULT');
  assert.doesNotMatch(privateSource.src, /cloud:\/\//);
});
