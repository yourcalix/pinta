'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CloudStore } = require('../cloudfunctions/api/lib/cloud-store');
const { publicActivity } = require('../cloudfunctions/api/lib/service');
const { stableEntityId } = require('../cloudfunctions/api/lib/ids');

const at = '2026-09-04T10:00:00.000Z';
test('Mock直接公开历史ride也固定七个槽位', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const { createRequire } = require('node:module');
  const filename = require.resolve('../miniprogram/mocks/server');
  const context = { require: createRequire(filename), module: { exports: {} }, console };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.reviewPublicActivity = publicActivity;', context);
  const dto = context.module.exports.reviewPublicActivity({ id: 'old', type: 'ride', maxMembers: 20, minMembers: 2, memberCount: 1, status: 'RECRUITING' }, { anonymous: true });
  assert.equal(dto.maxMembers, 7);
  assert.equal(dto.minMembers, 7);
  assert.equal(dto.avatarSlots.length, 7);
});
// In-memory transaction contract double; not a real CloudBase integration test.
function harness() {
  const tables = { activities: {}, members: {}, applications: {}, users: {}, memberContacts: {} };
  const doc = (source, name, id) => ({
    async get() { return { data: source[name][id] ? { ...structuredClone(source[name][id]), _id: id } : null }; },
    async set({ data }) { source[name][id] = structuredClone(data); },
    async update({ data }) {
      for (const [key, value] of Object.entries(data)) {
        if (value && value.$remove) delete source[name][id][key];
        else source[name][id][key] = structuredClone(value);
      }
    }
  });
  const db = {
    command: { remove: () => ({ $remove: true }) },
    collection(name) {
      let filter = {}, offset = 0, limit = 20;
      const query = { where(v) { filter = v; return query; }, skip(v) { offset = v; return query; }, limit(v) { limit = v; return query; },
        async get() { return { data: Object.entries(tables[name]).filter(([, row]) => Object.entries(filter).every(([k, v]) => row[k] === v)).slice(offset, offset + limit).map(([id, row]) => ({ ...structuredClone(row), _id: id })) }; } };
      return query;
    },
    async runTransaction(callback) {
      const snapshot = structuredClone(tables);
      const result = await callback({ collection: name => ({ doc: id => doc(snapshot, name, id) }) });
      Object.assign(tables, snapshot);
      return result;
    }
  };
  return { tables, store: new CloudStore({ database: () => db }) };
}

test('旧ride公开容量与头像固定七人，不被旧maxMembers覆盖', () => {
  const dto = publicActivity({ type: 'ride', maxMembers: 20, minMembers: 2, memberCount: 1, status: 'RECRUITING' });
  assert.equal(dto.maxMembers, 7);
  assert.equal(dto.minMembers, 7);
  assert.equal(dto.avatarSlots.length, 7);
  assert.equal(dto.remainingCapacity, 6);
});

for (const type of ['companion', 'sport', 'food']) test(`Cloud ${type}头像创建/审批/同步/退出事务字段`, async () => {
  const { store, tables } = harness();
  const memberId = stableEntityId('member', 'a', 'guest');
  const applicationId = stableEntityId('application', 'a', 'guest');
  await store.createActivityWithOwner({ id: 'a', type, ownerId: 'owner', minMembers: 2, maxMembers: 20, memberCount: 1, version: 1, status: 'RECRUITING', deadlineAt: '2026-09-05T00:00:00.000Z' }, { id: 'owner-member', activityId: 'a', userId: 'owner', avatarKind: 'PASSENGER_A', status: 'ACTIVE' });
  tables.users.guest = { profile: { gender: 'FEMALE' } };
  tables.applications[applicationId] = { activityId: 'a', applicantId: 'guest', status: 'PENDING' };
  const approved = await store.approveApplicationAtomic({ activityId: 'a', applicationId, ownerId: 'owner', at });
  assert.equal(approved.activity.avatarRoster.length, 2);
  assert.equal(tables.members[memberId].avatarKind, 'PASSENGER_B');
  const later = '2026-09-04T11:00:00.000Z';
  await store.syncUserAvatarKind('guest', 'PASSENGER_A', later);
  assert.equal(tables.activities.a.updatedAt, later);
  assert.equal(tables.activities.a.avatarRoster[1].avatarKind, 'PASSENGER_A');
  const left = await store.leaveActivity('a', 'guest', '', later);
  assert.equal(left.activity.avatarRoster.length, 1);
  assert.equal(tables.activities.a.avatarRoster.length, 1);
  assert.equal(tables.members[memberId].status, 'LEFT');
});
