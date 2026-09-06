'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CloudStore } = require('../cloudfunctions/api/lib/cloud-store');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');
const { publicActivity } = require('../cloudfunctions/api/lib/service');

function cloudHarness(count = 11) {
  const members = Array.from({ length: count }, (_, index) => ({
    _id: `member-${index}`,
    activityId: `activity-${index}`,
    userId: `user-${index}`,
    role: 'OWNER',
    status: 'ACTIVE',
    joinedAt: `2026-09-01T00:00:${String(index).padStart(2, '0')}.000Z`
  }));
  const users = Array.from({ length: count }, (_, index) => ({
    _id: `user-${index}`,
    status: 'ACTIVE',
    profile: {
      gender: index % 2 ? 'FEMALE' : 'MALE',
      birthDate: index === 1 ? '2000-09-05' : null,
      mbti: index === 1 ? 'INFP' : null,
      avatar: index === 0 ? { status: 'ACTIVE', fileID: 'cloud://env/random-avatar.jpg' } : null
    }
  }));
  const tables = { members, users };
  const queryChunks = [];
  const command = { in: (values) => ({ $in: values }) };
  const database = {
    command,
    collection(name) {
      let where = {};
      let offset = 0;
      let size = 20;
      const query = {
        where(value) { where = value; return query; },
        skip(value) { offset = value; return query; },
        limit(value) { size = value; return query; },
        async get() {
          for (const value of Object.values(where)) if (value && value.$in) queryChunks.push({ name, size: value.$in.length });
          const rows = (tables[name] || []).filter((row) => Object.entries(where).every(([key, value]) => {
            if (value && value.$in) return value.$in.includes(row[key]);
            return row[key] === value;
          }));
          return { data: rows.slice(offset, offset + size).map((row) => structuredClone(row)) };
        }
      };
      return query;
    }
  };
  const cloud = {
    database: () => database,
    async getTempFileURL({ fileList }) {
      return { fileList: fileList.map((fileID) => ({ fileID, tempFileURL: 'https://temp.example/avatar.jpg', status: 0 })) };
    }
  };
  return { store: new CloudStore(cloud), queryChunks, tables };
}

test('Cloud活动头像按十条分片批量水合且公共DTO不泄露身份字段', async () => {
  const { store, queryChunks } = cloudHarness();
  const activities = Array.from({ length: 11 }, (_, index) => ({
    id: `activity-${index}`,
    type: 'sport',
    title: `活动${index}`,
    maxMembers: 4,
    memberCount: 1,
    status: 'RECRUITING',
    avatarRoster: [{ memberId: `member-${index}`, avatarKind: index % 2 ? 'PASSENGER_B' : 'PASSENGER_A' }]
  }));
  const hydration = await store.hydratePublicActivityAvatars(activities);
  assert.ok(queryChunks.some((item) => item.name === 'members' && item.size === 10));
  assert.ok(queryChunks.some((item) => item.name === 'members' && item.size === 1));
  assert.ok(queryChunks.some((item) => item.name === 'users' && item.size === 10));
  assert.ok(queryChunks.some((item) => item.name === 'users' && item.size === 1));
  const dto = publicActivity(activities[0], {}, new Date().toISOString(), {
    roster: hydration.rostersByActivity['activity-0'],
    profilesByMemberId: hydration.profilesByMemberId,
    ownerProfile: hydration.ownerProfilesByActivity['activity-0']
  });
  assert.deepEqual(dto.avatarSlots[0], {
    kind: 'CUSTOM',
    src: 'https://temp.example/avatar.jpg',
    fallback: 'MALE_DEFAULT'
  });
  const serialized = JSON.stringify(dto.avatarSlots);
  assert.doesNotMatch(serialized, /member-0|user-0|cloudPath|uploadId|revision/);
  assert.deepEqual(dto.ownerProfile, {
    nickname: '拼吧用户',
    avatar: { kind: 'CUSTOM', src: 'https://temp.example/avatar.jpg', fallback: 'MALE_DEFAULT' },
    gender: 'MALE',
    age: null,
    mbti: null
  });
  assert.doesNotMatch(JSON.stringify(dto.ownerProfile), /birthDate|interests|adultConfirmed|cloud:\/\//);
  assert.doesNotMatch(JSON.stringify(dto), /birthDate|interests|adultConfirmed|cloud:\/\/|member-0|user-0/);
});

test('Cloud SDK无法签发临时URL时不公开原始fileID', async () => {
  const { store } = cloudHarness(1);
  delete store.cloud.getTempFileURL;
  const activity = {
    id: 'activity-0', type: 'sport', title: '回退测试', maxMembers: 2,
    memberCount: 1, status: 'RECRUITING', avatarRoster: [{ memberId: 'member-0', avatarKind: 'PASSENGER_A' }]
  };
  const hydration = await store.hydratePublicActivityAvatars([activity], '2026-09-06T04:00:00.000Z');
  const dto = publicActivity(activity, {}, new Date().toISOString(), {
    roster: hydration.rostersByActivity['activity-0'],
    profilesByMemberId: hydration.profilesByMemberId,
    ownerProfile: hydration.ownerProfilesByActivity['activity-0']
  });
  assert.deepEqual(dto.avatarSlots[0], { kind: 'DEFAULT', fallback: 'MALE_DEFAULT' });
  assert.deepEqual(dto.ownerProfile.avatar, { kind: 'DEFAULT', fallback: 'MALE_DEFAULT' });
  assert.doesNotMatch(JSON.stringify(dto.avatarSlots), /cloud:\/\//);
});

test('发起人头像按ownerId精确选择且公开DTO只保留白名单字段', async () => {
  const { store, tables } = cloudHarness(2);
  tables.members[0].activityId = 'activity-1';
  const activity = {
    id: 'activity-1', ownerId: 'user-1', owner: { nickname: '小树' }, type: 'sport', title: '周末运动',
    maxMembers: 4, minMembers: 2, memberCount: 2, status: 'RECRUITING',
    avatarRoster: [{ memberId: 'member-0' }, { memberId: 'member-1' }]
  };
  const hydration = await store.hydratePublicActivityAvatars([activity], '2026-09-06T04:00:00.000Z');
  const dto = publicActivity(activity, {}, new Date().toISOString(), {
    roster: hydration.rostersByActivity[activity.id],
    profilesByMemberId: hydration.profilesByMemberId,
    ownerProfile: hydration.ownerProfilesByActivity[activity.id]
  });
  assert.equal(dto.ownerProfile.nickname, '小树');
  assert.deepEqual(dto.ownerProfile.avatar, { kind: 'DEFAULT', fallback: 'FEMALE_DEFAULT' });
  assert.equal(dto.ownerProfile.gender, 'FEMALE');
  assert.equal(dto.ownerProfile.age, 26);
  assert.equal(dto.ownerProfile.mbti, 'INFP');
  assert.deepEqual(Object.keys(dto.ownerProfile).sort(), ['age', 'avatar', 'gender', 'mbti', 'nickname']);
  assert.doesNotMatch(JSON.stringify(dto.ownerProfile), /2000-09-05|birthDate|interests|adultConfirmed|user-1|member-1/);
});

test('Memory模式与Cloud模式使用相同的发起人公开资料契约', async () => {
  const store = new MemoryStore({
    users: [{
      id: 'owner-1',
      status: 'ACTIVE',
      profile: {
        gender: 'MALE',
        birthDate: '2000-09-05',
        mbti: 'ENTP',
        avatar: { status: 'ACTIVE', fileID: 'https://cdn.example/owner.jpg' }
      }
    }],
    members: [{
      id: 'member-owner-1',
      activityId: 'activity-memory-1',
      userId: 'owner-1',
      role: 'OWNER',
      status: 'ACTIVE',
      joinedAt: '2026-09-01T00:00:00.000Z'
    }]
  });
  const activity = {
    id: 'activity-memory-1',
    ownerId: 'owner-1',
    owner: { nickname: '阿启' },
    type: 'companion',
    title: '周末同行',
    minMembers: 2,
    maxMembers: 4,
    memberCount: 1,
    status: 'RECRUITING',
    avatarRoster: [{ memberId: 'member-owner-1' }]
  };
  const hydration = await store.hydratePublicActivityAvatars([activity], '2026-09-06T04:00:00.000Z');
  const dto = publicActivity(activity, {}, '2026-09-06T04:00:00.000Z', {
    roster: hydration.rostersByActivity[activity.id],
    profilesByMemberId: hydration.profilesByMemberId,
    ownerProfile: hydration.ownerProfilesByActivity[activity.id]
  });

  assert.deepEqual(dto.ownerProfile, {
    nickname: '阿启',
    avatar: {
      kind: 'CUSTOM',
      src: 'https://cdn.example/owner.jpg',
      fallback: 'MALE_DEFAULT'
    },
    gender: 'MALE',
    age: 26,
    mbti: 'ENTP'
  });
  assert.doesNotMatch(JSON.stringify(dto.ownerProfile), /2000-09-05|birthDate|owner-1|member-owner-1/);
});

test('历史活动缺少OWNER成员时按ownerId受控水合，停用用户仍保持隐藏', async () => {
  const { store, tables } = cloudHarness(2);
  tables.members.splice(0, tables.members.length);
  tables.users[1].profile.avatar = { status: 'ACTIVE', fileID: 'cloud://env/owner-history.jpg' };
  const activity = {
    id: 'activity-history', ownerId: 'user-1', owner: { nickname: '历史发起人' }, type: 'food', title: '历史饭桌',
    minMembers: 2, maxMembers: 4, memberCount: 1, status: 'RECRUITING', avatarRoster: []
  };

  const hydration = await store.hydratePublicActivityAvatars([activity], '2026-09-06T04:00:00.000Z');
  const dto = publicActivity(activity, {}, '2026-09-06T04:00:00.000Z', {
    roster: hydration.rostersByActivity[activity.id],
    profilesByMemberId: hydration.profilesByMemberId,
    ownerProfile: hydration.ownerProfilesByActivity[activity.id]
  });
  assert.equal(dto.ownerProfile.gender, 'FEMALE');
  assert.equal(dto.ownerProfile.age, 26);
  assert.equal(dto.ownerProfile.mbti, 'INFP');
  assert.equal(dto.ownerProfile.avatar.kind, 'CUSTOM');
  assert.doesNotMatch(JSON.stringify(dto), /cloud:\/\/|user-1/);

  tables.users[1].status = 'DISABLED';
  const hiddenHydration = await store.hydratePublicActivityAvatars([activity], '2026-09-06T04:00:00.000Z');
  const hiddenDto = publicActivity(activity, {}, '2026-09-06T04:00:00.000Z', {
    roster: hiddenHydration.rostersByActivity[activity.id],
    profilesByMemberId: hiddenHydration.profilesByMemberId,
    ownerProfile: hiddenHydration.ownerProfilesByActivity[activity.id]
  });
  assert.deepEqual(hiddenDto.ownerProfile, {
    nickname: '历史发起人',
    avatar: { kind: 'EMPTY' },
    gender: null,
    age: null,
    mbti: null
  });
});

test('Memory模式不会把cloud fileID公开为发起人头像', async () => {
  const store = new MemoryStore({
    users: [{
      id: 'owner-cloud', status: 'ACTIVE',
      profile: {
        gender: 'FEMALE', birthDate: '2000-09-05', mbti: 'ISFJ',
        avatar: { status: 'ACTIVE', fileID: 'cloud://env/private-avatar.jpg' }
      }
    }],
    members: []
  });
  const activity = {
    id: 'activity-cloud-fallback', ownerId: 'owner-cloud', owner: { nickname: '阿禾' }, type: 'sport',
    title: '历史运动', minMembers: 2, maxMembers: 4, memberCount: 1, status: 'RECRUITING', avatarRoster: []
  };
  const hydration = await store.hydratePublicActivityAvatars([activity], '2026-09-06T04:00:00.000Z');
  const dto = publicActivity(activity, {}, '2026-09-06T04:00:00.000Z', {
    roster: hydration.rostersByActivity[activity.id],
    profilesByMemberId: hydration.profilesByMemberId,
    ownerProfile: hydration.ownerProfilesByActivity[activity.id]
  });

  assert.deepEqual(dto.ownerProfile.avatar, { kind: 'DEFAULT', fallback: 'FEMALE_DEFAULT' });
  assert.doesNotMatch(JSON.stringify(dto), /cloud:\/\//);
});
