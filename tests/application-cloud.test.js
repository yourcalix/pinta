'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CloudStore } = require('../cloudfunctions/api/lib/cloud-store');
const { stableEntityId } = require('../cloudfunctions/api/lib/ids');

const activityId = 'activity-application-cloud';
const actorId = 'applicant';
const applicationId = stableEntityId('application', activityId, actorId);
const memberId = stableEntityId('member', activityId, actorId);
const createdAt = '2026-09-22T02:00:00.000Z';

function application(overrides = {}) {
  return {
    id: applicationId,
    activityId,
    applicantId: actorId,
    applicant: { id: actorId, nickname: '申请人' },
    status: 'PENDING',
    note: '',
    autoJoinConsent: true,
    submissionKeyHash: 'submission-a',
    createdAt,
    updatedAt: createdAt,
    ...overrides
  };
}

function harness({ existingApplication = null, member = null, readFailure = null } = {}) {
  const tables = new Map([
    ['activities', new Map([[activityId, {
      _id: activityId,
      type: 'food',
      ownerId: 'owner',
      status: 'RECRUITING',
      memberCount: 1,
      minMembers: 2,
      maxMembers: 4,
      deadlineAt: '2026-09-23T02:00:00.000Z'
    }]])],
    ['applications', new Map()],
    ['members', new Map()]
  ]);
  if (existingApplication) tables.get('applications').set(applicationId, { _id: applicationId, ...existingApplication });
  if (member) tables.get('members').set(memberId, { _id: memberId, ...member });

  const documentReference = (source, name, id) => ({
    async get() {
      if (readFailure && readFailure.name === name && readFailure.id === id) throw readFailure.error;
      const value = source.get(name).get(id);
      if (!value) throw { errCode: -502005, errMsg: 'document does not exist' };
      return { data: structuredClone(value) };
    },
    async set({ data }) {
      source.get(name).set(id, { _id: id, ...structuredClone(data) });
    }
  });
  const db = {
    command: {},
    async runTransaction(callback) {
      const snapshot = structuredClone(tables);
      const result = await callback({
        collection: (name) => ({ doc: (id) => documentReference(snapshot, name, id) })
      });
      tables.clear();
      for (const [name, rows] of snapshot) tables.set(name, rows);
      return result;
    }
  };
  return { tables, store: new CloudStore({ database: () => db }) };
}

test('Cloud首次申请把事务缺失文档视为正常空值并写入稳定申请ID', async () => {
  const { store, tables } = harness();
  const result = await store.createApplication(application());
  assert.equal(result.id, applicationId);
  assert.equal(tables.get('applications').get(applicationId).applicantId, actorId);
});

test('Cloud申请保持幂等、重复申请与现有成员冲突语义', async () => {
  const same = application();
  const replay = harness({ existingApplication: same });
  assert.equal((await replay.store.createApplication(application())).submissionKeyHash, same.submissionKeyHash);

  const duplicate = harness({ existingApplication: { ...same, submissionKeyHash: 'submission-old' } });
  await assert.rejects(duplicate.store.createApplication(application()), { code: 'CONFLICT' });

  const joined = harness({
    member: { activityId, userId: actorId, status: 'ACTIVE', role: 'MEMBER' }
  });
  await assert.rejects(joined.store.createApplication(application()), { code: 'CONFLICT' });
});

test('Cloud申请只归一化文档不存在，其他数据库错误继续外抛', async () => {
  const sdkError = { errCode: -1, errMsg: 'database unavailable' };
  const { store } = harness({
    readFailure: { name: 'applications', id: applicationId, error: sdkError }
  });
  await assert.rejects(store.createApplication(application()), (error) => error === sdkError);
});
