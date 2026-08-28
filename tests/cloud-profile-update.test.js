'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CloudStore } = require('../cloudfunctions/api/lib/cloud-store');

test('CloudStore 以事务整字段替换从 null 初始化用户资料并保留其他字段', async () => {
  const stored = {
    _id: 'user-1',
    role: 'user',
    status: 'ACTIVE',
    profile: null,
    onboarding: { roleIntent: 'PASSENGER' },
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z'
  };
  let written = null;
  const documentRef = {
    async get() { return { data: stored }; },
    async set({ data }) { written = data; }
  };
  const cloud = {
    database() {
      return {
        command: {},
        async runTransaction(callback) {
          return callback({
            collection(name) {
              assert.equal(name, 'users');
              return { doc: (id) => {
                assert.equal(id, 'user-1');
                return documentRef;
              } };
            }
          });
        }
      };
    }
  };
  const profile = { nickname: 'pinba test', city: '澳门', interests: [], adultConfirmed: true };
  const store = new CloudStore(cloud);

  const updated = await store.updateProfile('user-1', profile, '2026-08-28T01:00:00.000Z');

  assert.deepEqual(updated.profile, profile);
  assert.deepEqual(updated.onboarding, stored.onboarding);
  assert.deepEqual(written.profile, profile);
  assert.deepEqual(written.onboarding, stored.onboarding);
  assert.equal(written._id, undefined);
  assert.equal(written.updatedAt, '2026-08-28T01:00:00.000Z');
});

test('CloudStore 创建活动时将事务缺失文档错误视为空槽位', async () => {
  const writes = [];
  const missing = new Error('document.get:fail document with _id activity-preview does not exist');
  missing.errCode = -502005;
  const transaction = {
    collection(name) {
      return {
        doc(id) {
          return {
            async get() {
              if (name === 'activities') throw missing;
              return { data: null };
            },
            async set({ data }) {
              writes.push({ name, id, data });
            }
          };
        }
      };
    }
  };
  const cloud = {
    database() {
      return {
        command: {},
        async runTransaction(callback) {
          return callback(transaction);
        }
      };
    }
  };
  const store = new CloudStore(cloud);
  const activity = { id: 'activity-preview', operationKeyHash: 'op', payloadHash: 'payload' };
  const ownerMember = { id: 'member-preview', activityId: activity.id };
  const fulfillment = { id: 'fulfillment-preview', activityId: activity.id };

  const result = await store.createActivityWithOwner(activity, ownerMember, fulfillment);

  assert.equal(result, activity);
  assert.deepEqual(writes.map((item) => [item.name, item.id]), [
    ['activities', 'activity-preview'],
    ['members', 'member-preview'],
    ['rideFulfillments', 'fulfillment-preview']
  ]);
});
