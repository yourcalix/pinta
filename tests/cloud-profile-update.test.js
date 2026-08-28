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

test('CloudStore 首次提交司机认证时将不存在的申请文档视为空记录', async () => {
  const at = '2026-08-28T01:00:00.000Z';
  const userId = 'driver-candidate';
  const uploadId = 'upload-identity-front';
  const missing = new Error(`document.get:fail document with _id ${userId} does not exist`);
  missing.errCode = -502005;
  const writes = [];
  const updates = [];
  const transaction = {
    collection(name) {
      return {
        doc(id) {
          return {
            async get() {
              if (name === 'driverApplications') throw missing;
              if (name === 'driverDocumentUploads' && id === uploadId) {
                return {
                  data: {
                    _id: uploadId,
                    userId,
                    kind: 'identityFront',
                    status: 'INSPECTED',
                    expiresAt: '2026-08-28T02:00:00.000Z',
                    sealedFileID: 'cloud://test/private-driver-sealed/identity.bin'
                  }
                };
              }
              return { data: null };
            },
            async set({ data }) { writes.push({ name, id, data }); },
            async update({ data }) { updates.push({ name, id, data }); }
          };
        }
      };
    }
  };
  const cloud = {
    database() {
      return {
        command: {},
        async runTransaction(callback) { return callback(transaction); }
      };
    }
  };
  const store = new CloudStore(cloud);
  const application = {
    id: userId,
    userId,
    status: 'APPROVED',
    revision: 1,
    operationKeyHash: 'operation-hash',
    payloadHash: 'payload-hash',
    documentFileHashes: { identityFront: 'file-hash' },
    summary: {
      vehicleType: '七座轿车',
      plateMasked: '***45',
      passengerCapacity: 7
    },
    updatedAt: at
  };
  const documentRefs = {
    identityFront: {
      uploadId,
      fileID: 'cloud://test/private-driver-sealed/identity.bin'
    }
  };

  const result = await store.submitDriverApplication({
    userId,
    application,
    secrets: { keyVersion: 1 },
    documentRefs,
    autoApprove: true,
    audit: { id: 'audit-driver-submit', action: 'driver.application.submit', at }
  });

  assert.equal(result, application);
  assert.deepEqual(updates.map((item) => [item.name, item.id]), [
    ['driverDocumentUploads', uploadId]
  ]);
  assert.deepEqual(writes.map((item) => [item.name, item.id]), [
    ['driverApplications', userId],
    ['driverSecrets', userId],
    ['drivers', userId],
    ['vehicles', `vehicle-${userId}`],
    ['auditLogs', 'audit-driver-submit']
  ]);
});

test('CloudStore 司机认证读取遇到非缺失事务错误时继续向外抛出', async () => {
  const permissionError = new Error('database permission denied');
  permissionError.errCode = -502003;
  const cloud = {
    database() {
      return {
        command: {},
        async runTransaction(callback) {
          return callback({
            collection() {
              return { doc: () => ({ async get() { throw permissionError; } }) };
            }
          });
        }
      };
    }
  };
  const store = new CloudStore(cloud);

  await assert.rejects(
    store.submitDriverApplication({
      userId: 'driver-candidate',
      application: { id: 'driver-candidate', updatedAt: '2026-08-28T01:00:00.000Z' },
      secrets: {},
      documentRefs: {},
      audit: null
    }),
    (error) => error === permissionError
  );
});

test('CloudStore 司机认证事务后段失败时不提交申请、敏感记录或上传绑定', async () => {
  const committed = [];
  const missing = new Error('document does not exist');
  missing.errCode = -502005;
  const auditFailure = new Error('audit write failed');
  const userId = 'driver-candidate';
  const uploadId = 'upload-identity-front';
  const cloud = {
    database() {
      return {
        command: {},
        async runTransaction(callback) {
          const pending = [];
          const transaction = {
            collection(name) {
              return {
                doc(id) {
                  return {
                    async get() {
                      if (name === 'driverApplications') throw missing;
                      if (name === 'driverDocumentUploads') {
                        return {
                          data: {
                            _id: uploadId,
                            userId,
                            kind: 'identityFront',
                            status: 'INSPECTED',
                            expiresAt: '2026-08-28T02:00:00.000Z',
                            sealedFileID: 'cloud://test/private-driver-sealed/identity.bin'
                          }
                        };
                      }
                      return { data: null };
                    },
                    async update({ data }) { pending.push({ type: 'update', name, id, data }); },
                    async set({ data }) {
                      if (name === 'auditLogs') throw auditFailure;
                      pending.push({ type: 'set', name, id, data });
                    }
                  };
                }
              };
            }
          };
          const result = await callback(transaction);
          committed.push(...pending);
          return result;
        }
      };
    }
  };
  const store = new CloudStore(cloud);

  await assert.rejects(store.submitDriverApplication({
    userId,
    application: {
      id: userId,
      operationKeyHash: 'operation-hash',
      payloadHash: 'payload-hash',
      revision: 1,
      documentFileHashes: { identityFront: 'file-hash' },
      updatedAt: '2026-08-28T01:00:00.000Z'
    },
    secrets: { keyVersion: 1 },
    documentRefs: {
      identityFront: {
        uploadId,
        fileID: 'cloud://test/private-driver-sealed/identity.bin'
      }
    },
    audit: { id: 'audit-driver-submit' }
  }), (error) => error === auditFailure);

  assert.deepEqual(committed, []);
});
