'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CloudStore } = require('../cloudfunctions/api/lib/cloud-store');
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
  return { store: new CloudStore(cloud), queryChunks };
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
    profilesByMemberId: hydration.profilesByMemberId
  });
  assert.deepEqual(dto.avatarSlots[0], {
    kind: 'CUSTOM',
    src: 'https://temp.example/avatar.jpg',
    fallback: 'MALE_DEFAULT'
  });
  const serialized = JSON.stringify(dto.avatarSlots);
  assert.doesNotMatch(serialized, /member-0|user-0|cloudPath|uploadId|revision/);
});

test('Cloud SDK无法签发临时URL时不公开原始fileID', async () => {
  const { store } = cloudHarness(1);
  delete store.cloud.getTempFileURL;
  const activity = {
    id: 'activity-0', type: 'sport', title: '回退测试', maxMembers: 2,
    memberCount: 1, status: 'RECRUITING', avatarRoster: [{ memberId: 'member-0', avatarKind: 'PASSENGER_A' }]
  };
  const hydration = await store.hydratePublicActivityAvatars([activity]);
  const dto = publicActivity(activity, {}, new Date().toISOString(), {
    roster: hydration.rostersByActivity['activity-0'],
    profilesByMemberId: hydration.profilesByMemberId
  });
  assert.deepEqual(dto.avatarSlots[0], { kind: 'DEFAULT', fallback: 'MALE_DEFAULT' });
  assert.doesNotMatch(JSON.stringify(dto.avatarSlots), /cloud:\/\//);
});
