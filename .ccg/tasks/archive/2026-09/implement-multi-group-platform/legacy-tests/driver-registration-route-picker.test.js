'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  RIDE_ROUTES,
  RIDE_ROUTE_ORIGINS,
  rideRoutePickerState,
  rideRouteFromIndexes
} = require('../miniprogram/config/locations');
const { createPinbaService } = require('../cloudfunctions/api/lib/service');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');

test('双列滚轮只生成 8 条固定合法路线', () => {
  assert.equal(RIDE_ROUTE_ORIGINS.length, 4);
  const generated = [];
  RIDE_ROUTE_ORIGINS.forEach((origin, originIndex) => {
    const state = rideRoutePickerState(RIDE_ROUTES.find((route) => route.origin === origin).id);
    assert.equal(state.columns[1].length, 2);
    state.columns[1].forEach((destination, destinationIndex) => {
      const route = rideRouteFromIndexes([originIndex, destinationIndex]);
      generated.push(route.id);
      assert.equal(route.origin, origin);
      assert.equal(route.destination, destination);
    });
  });
  assert.deepEqual(new Set(generated), new Set(RIDE_ROUTES.map((route) => route.id)));
});

test('routeId 可回填滚轮且越界索引会安全钳制', () => {
  const state = rideRoutePickerState('GOLDEN_DRAGON_TO_HENGQIN');
  assert.deepEqual(state.indexes, [3, 1]);
  assert.equal(state.route.code, '龍琴');
  assert.equal(rideRouteFromIndexes([3, 99]).id, 'GOLDEN_DRAGON_TO_HENGQIN');
  assert.equal(rideRouteFromIndexes([-1, -1]).id, 'QINGMAO_TO_TAIPA');
});

test('司机注册页面和服务契约不在本人资料 DTO 中回显证件字段', () => {
  const service = require('../cloudfunctions/api/lib/service');
  const source = service.selfUser({
    role: 'user',
    status: 'ACTIVE',
    profile: { nickname: '测试', gender: 'MALE', city: '澳门', adultConfirmed: true },
    onboarding: { roleIntent: 'DRIVER' },
    identityNumber: 'sensitive-value',
    documentFileId: 'private-file-id'
  });
  assert.equal(source.identityNumber, undefined);
  assert.equal(source.documentFileId, undefined);
  assert.equal(source.onboarding.roleIntent, 'DRIVER');
});

test('司机认证写请求的本地幂等指纹不包含完整敏感 payload', () => {
  const api = require('../miniprogram/services/api');
  const payload = {
    legalName: '测试司机',
    identityNumber: 'A1234567',
    driverLicenseNumber: 'DL987654',
    documents: { identityFront: { uploadId: 'upload-1' } }
  };
  const first = api.makeMutationFingerprint('session', 'driver.application.submit', payload);
  const replay = api.makeMutationFingerprint('session', 'driver.application.submit', payload);
  assert.equal(first, replay);
  assert.match(first, /:opaque:[0-9a-f]{16}$/);
  assert.equal(first.includes('A1234567'), false);
  assert.equal(first.includes('DL987654'), false);
  assert.equal(first.includes('测试司机'), false);
  const mockSource = fs.readFileSync(path.join(__dirname, '../miniprogram/mocks/server.js'), 'utf8');
  assert.match(mockSource, /payloadHash = opaqueSensitiveHash\(stableSerialize\(input\)\)/);
  assert.doesNotMatch(mockSource, /payloadHash = stableSerialize\(input\)/);
});

function activeUser(id, role = 'user') {
  return {
    id, role, status: 'ACTIVE',
    profile: { nickname: id, gender: 'MALE', city: '澳门', interests: [], adultConfirmed: true },
    createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z'
  };
}

function driverPayload(documents = {}) {
  return {
    legalName: '测试司机', identityType: 'MACAU_RESIDENT_ID', identityNumber: 'A1234567',
    identityExpiresAt: '2030-01-01T23:59:59.000Z',
    driverLicenseNumber: 'DL987654', driverLicenseExpiresAt: '2030-01-01T23:59:59.000Z',
    vehicleType: '七座轿车', passengerCapacity: 4, plateNumber: 'M12345',
    documents,
    consent: { privacyVersion: 'driver-privacy-v1', driverVerify: true, sensitiveDocuments: true }
  };
}

test('司机意向不授予权限，只有开发审核通过才物化司机与车辆事实源', async () => {
  const store = new MemoryStore({
    users: [activeUser('candidate'), activeUser('reviewer', 'admin')]
  });
  const service = createPinbaService({
    store,
    clock: () => new Date('2026-08-27T00:00:00.000Z'),
    idGenerator: () => 'request-id',
    driverCredentialSecret: 'synthetic-test-secret-value',
    driverReviewEnabled: true,
    rideDriverAcceptanceEnabled: true
  });
  const call = (action, data, actorId, key) => service.execute({
    action, data, requestId: `${action}-request`, idempotencyKey: key || `${action.replace(/\./g, '-')}-12345678`
  }, { actorId });

  const selected = await call('onboarding.selectRole', { roleIntent: 'DRIVER' }, 'candidate');
  assert.equal(selected.ok, true);
  assert.equal((await call('ride.driver.profile', {}, 'candidate')).data.driver.canAcceptRide, false);

  const documents = {};
  for (const kind of ['identityFront', 'driverLicense', 'vehicleExterior']) {
    const prepared = await call('driver.document.prepare', { kind }, 'candidate', `prepare-${kind}-12345678`);
    const uploadReference = {
      uploadId: prepared.data.upload.id,
      fileID: `cloud://test-env/${prepared.data.upload.cloudPath}`
    };
    const confirmed = await call('driver.document.confirm', { kind, ...uploadReference }, 'candidate', `confirm-${kind}-12345678`);
    assert.equal(confirmed.ok, true);
    documents[kind] = { uploadId: uploadReference.uploadId };
  }
  const submitted = await call('driver.application.submit', driverPayload(documents), 'candidate');
  assert.equal(submitted.ok, true);
  assert.equal(submitted.data.application.status, 'SUBMITTED');
  assert.equal(submitted.data.application.summary.identityLast4, '4567');
  assert.equal(JSON.stringify(submitted.data).includes('A1234567'), false);
  assert.equal(JSON.stringify(submitted.data).includes('cloud://private'), false);
  assert.equal((await call('ride.driver.profile', {}, 'candidate')).data.driver.canAcceptRide, false);

  const reviewed = await call('admin.driverApplication.review', {
    userId: 'candidate', decision: 'APPROVED', reasonCode: ''
  }, 'reviewer');
  assert.equal(reviewed.ok, true);
  const conflictingReview = await call('admin.driverApplication.review', {
    userId: 'candidate', decision: 'NEEDS_MORE_INFO', reasonCode: 'DIFFERENT_DECISION'
  }, 'reviewer');
  assert.equal(conflictingReview.ok, false);
  assert.equal(conflictingReview.error.code, 'CONFLICT');
  const profile = await call('ride.driver.profile', {}, 'candidate');
  assert.equal(profile.data.driver.canAcceptRide, true);
  assert.equal(profile.data.driver.vehicles[0].canUseForRide, true);
});

test('开发自动审核在提交事务中直接通过并由幂等重放补齐司机车辆事实', async () => {
  const store = new MemoryStore({
    users: [activeUser('candidate')]
  });
  const service = createPinbaService({
    store,
    clock: () => new Date('2026-08-27T00:00:00.000Z'),
    idGenerator: () => 'request-id',
    driverCredentialSecret: 'synthetic-test-secret-value',
    driverReviewEnabled: true,
    driverApplicationAutoApprove: true,
    driverAutoApprovalEnvironment: 'test',
    rideDriverAcceptanceEnabled: true
  });
  const call = (action, data, key) => service.execute({
    action,
    data,
    requestId: `${action}-request`,
    idempotencyKey: key
  }, { actorId: 'candidate' });
  const documents = {};
  for (const kind of ['identityFront', 'driverLicense', 'vehicleExterior']) {
    const prepared = await call('driver.document.prepare', { kind }, `auto-${kind}-prepare-12345678`);
    const reference = {
      uploadId: prepared.data.upload.id,
      fileID: `cloud://test-env/${prepared.data.upload.cloudPath}`
    };
    await call('driver.document.confirm', { kind, ...reference }, `auto-${kind}-confirm-12345678`);
    documents[kind] = { uploadId: reference.uploadId };
  }
  const submitKey = 'auto-submit-12345678';
  const submitted = await call('driver.application.submit', driverPayload(documents), submitKey);

  assert.equal(submitted.ok, true);
  assert.equal(submitted.data.application.status, 'APPROVED');
  assert.equal(submitted.data.application.review.reasonCode, 'DEV_AUTO_APPROVED');
  assert.equal(store.drivers.get('candidate').reviewStatus, 'APPROVED');
  assert.equal(store.vehicles.get('vehicle-candidate').reviewStatus, 'APPROVED');
  assert.ok([...store.auditLogs.values()].some((item) => item.reasonCode === 'DEV_AUTO_APPROVED'));
  assert.ok([...store.auditLogs.values()].some((item) => item.autoApprovalEnvironment === 'test' && item.autoApprovalGateEnabled === true));

  store.drivers.delete('candidate');
  store.vehicles.delete('vehicle-candidate');
  const replay = await call('driver.application.submit', driverPayload(documents), submitKey);

  assert.equal(replay.ok, true);
  assert.equal(replay.data.application.status, 'APPROVED');
  assert.equal(store.drivers.get('candidate').reviewStatus, 'APPROVED');
  assert.equal(store.vehicles.get('vehicle-candidate').reviewStatus, 'APPROVED');
});

test('开发自动审核并发不同幂等键只批准并物化一次', async () => {
  const store = new MemoryStore({
    users: [activeUser('candidate')]
  });
  const service = createPinbaService({
    store,
    clock: () => new Date('2026-08-27T00:00:00.000Z'),
    driverCredentialSecret: 'synthetic-test-secret-value',
    driverReviewEnabled: true,
    driverApplicationAutoApprove: true,
    driverAutoApprovalEnvironment: 'test'
  });
  const call = (action, data, key) => service.execute({ action, data, idempotencyKey: key }, { actorId: 'candidate' });
  const documents = {};
  for (const kind of ['identityFront', 'driverLicense', 'vehicleExterior']) {
    const prepared = await call('driver.document.prepare', { kind }, `concurrent-${kind}-prepare-12345678`);
    const reference = { uploadId: prepared.data.upload.id, fileID: `cloud://test/${prepared.data.upload.cloudPath}` };
    await call('driver.document.confirm', { kind, ...reference }, `concurrent-${kind}-confirm-12345678`);
    documents[kind] = { uploadId: reference.uploadId };
  }

  const results = await Promise.all([
    call('driver.application.submit', driverPayload(documents), 'concurrent-submit-a-12345678'),
    call('driver.application.submit', driverPayload(documents), 'concurrent-submit-b-12345678')
  ]);

  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok && result.error.code === 'DRIVER_APPLICATION_LOCKED').length, 1);
  assert.equal(store.drivers.size, 1);
  assert.equal(store.vehicles.size, 1);
  assert.equal([...store.auditLogs.values()].filter((item) => item.reasonCode === 'DEV_AUTO_APPROVED').length, 1);
});

test('自动审核关闭时保持待审，后续开启也不会隐式升级旧申请', async () => {
  const store = new MemoryStore({
    users: [activeUser('candidate')]
  });
  const baseOptions = {
    store,
    clock: () => new Date('2026-08-27T00:00:00.000Z'),
    driverCredentialSecret: 'synthetic-test-secret-value'
  };
  const manualService = createPinbaService(baseOptions);
  const call = (service, action, data, key) => service.execute({ action, data, idempotencyKey: key }, { actorId: 'candidate' });
  const documents = {};
  for (const kind of ['identityFront', 'driverLicense', 'vehicleExterior']) {
    const prepared = await call(manualService, 'driver.document.prepare', { kind }, `manual-${kind}-prepare-12345678`);
    const reference = { uploadId: prepared.data.upload.id, fileID: `cloud://test/${prepared.data.upload.cloudPath}` };
    await call(manualService, 'driver.document.confirm', { kind, ...reference }, `manual-${kind}-confirm-12345678`);
    documents[kind] = { uploadId: reference.uploadId };
  }
  const submitted = await call(manualService, 'driver.application.submit', driverPayload(documents), 'manual-submit-12345678');
  assert.equal(submitted.data.application.status, 'SUBMITTED');

  const autoService = createPinbaService({ ...baseOptions, driverReviewEnabled: true, driverApplicationAutoApprove: true });
  const retry = await call(autoService, 'driver.application.submit', driverPayload(documents), 'different-submit-12345678');
  assert.equal(retry.ok, false);
  assert.equal(retry.error.code, 'DRIVER_APPLICATION_PENDING');
  assert.equal(store.drivers.has('candidate'), false);
  assert.equal(store.vehicles.has('vehicle-candidate'), false);
});

test('云函数入口只在开发或测试环境且审核开关开启时自动通过', () => {
  const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/api/index.js'), 'utf8');
  assert.match(source, /\['development', 'test'\]\.includes\(process\.env\.PINBA_ENV\)/);
  assert.match(source, /process\.env\.ENABLE_DEV_DRIVER_REVIEW === 'true'/);
  assert.match(source, /driverApplicationAutoApprove:\s*developmentDriverReviewEnabled/);
  assert.match(source, /driverAutoApprovalEnvironment:\s*developmentDriverReviewEnabled\s*\?\s*process\.env\.PINBA_ENV\s*:\s*''/);
});

test('未配置凭据密钥时司机申请 fail-closed', async () => {
  const store = new MemoryStore({
    users: [activeUser('candidate')]
  });
  const service = createPinbaService({ store, clock: () => new Date('2026-08-27T00:00:00.000Z') });
  const documents = {};
  for (const kind of ['identityFront', 'driverLicense', 'vehicleExterior']) {
    const prepared = await service.execute({
      action: 'driver.document.prepare', data: { kind }, idempotencyKey: `missing-${kind}-12345678`
    }, { actorId: 'candidate' });
    const uploadReference = { uploadId: prepared.data.upload.id, fileID: `cloud://test/${prepared.data.upload.cloudPath}` };
    const confirmed = await service.execute({
      action: 'driver.document.confirm', data: { kind, ...uploadReference }, idempotencyKey: `missing-confirm-${kind}-12345678`
    }, { actorId: 'candidate' });
    assert.equal(confirmed.ok, true);
    documents[kind] = { uploadId: uploadReference.uploadId };
  }
  const result = await service.execute({
    action: 'driver.application.submit', data: driverPayload(documents), idempotencyKey: 'missing-secret-12345678'
  }, { actorId: 'candidate' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'DRIVER_APPLICATION_UNAVAILABLE');
});

test('上传凭据严格绑定本人和资料类型，司机申请业务幂等可恢复', async () => {
  const store = new MemoryStore({
    users: [activeUser('candidate'), activeUser('attacker')]
  });
  const service = createPinbaService({
    store, clock: () => new Date('2026-08-27T00:00:00.000Z'),
    driverCredentialSecret: 'synthetic-test-secret-value'
  });
  const call = (action, data, actorId, key) => service.execute({ action, data, idempotencyKey: key }, { actorId });
  const documents = {};
  for (const kind of ['identityFront', 'driverLicense', 'vehicleExterior']) {
    const owner = kind === 'identityFront' ? 'attacker' : 'candidate';
    const prepared = await call('driver.document.prepare', { kind }, owner, `owner-${kind}-12345678`);
    const uploadReference = { uploadId: prepared.data.upload.id, fileID: `cloud://test/${prepared.data.upload.cloudPath}` };
    await call('driver.document.confirm', { kind, ...uploadReference }, owner, `owner-confirm-${kind}-12345678`);
    documents[kind] = { uploadId: uploadReference.uploadId };
  }
  const forbidden = await call('driver.application.submit', driverPayload(documents), 'candidate', 'submit-owned-files-12345678');
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.error.code, 'DRIVER_DOCUMENT_REQUIRED');

  const fixed = await call('driver.document.prepare', { kind: 'identityFront' }, 'candidate', 'owner-fixed-id-12345678');
  const fixedReference = { uploadId: fixed.data.upload.id, fileID: `cloud://test/${fixed.data.upload.cloudPath}` };
  await call('driver.document.confirm', { kind: 'identityFront', ...fixedReference }, 'candidate', 'owner-fixed-confirm-12345678');
  documents.identityFront = { uploadId: fixedReference.uploadId };
  const first = await call('driver.application.submit', driverPayload(documents), 'candidate', 'submit-replay-safe-12345678');
  const replay = await call('driver.application.submit', driverPayload(documents), 'candidate', 'submit-replay-safe-12345678');
  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  assert.equal(replay.data.application.revision, 1);
});

test('未经服务端图片检查的上传凭据不能提交司机申请', async () => {
  const store = new MemoryStore({
    users: [activeUser('candidate')]
  });
  const service = createPinbaService({
    store,
    clock: () => new Date('2026-08-27T00:00:00.000Z'),
    driverCredentialSecret: 'synthetic-test-secret-value'
  });
  const documents = {};
  for (const kind of ['identityFront', 'driverLicense', 'vehicleExterior']) {
    const prepared = await service.execute({
      action: 'driver.document.prepare', data: { kind }, idempotencyKey: `uninspected-${kind}-12345678`
    }, { actorId: 'candidate' });
    documents[kind] = { uploadId: prepared.data.upload.id, fileID: `cloud://test/${prepared.data.upload.cloudPath}` };
  }
  const submitted = await service.execute({
    action: 'driver.application.submit', data: driverPayload(documents), idempotencyKey: 'uninspected-submit-12345678'
  }, { actorId: 'candidate' });
  assert.equal(submitted.ok, false);
  assert.equal(submitted.error.code, 'DRIVER_DOCUMENT_REQUIRED');
});

test('生产默认不开放司机审核，撤回会把敏感记录转入待清理状态', async () => {
  const store = new MemoryStore({
    users: [activeUser('candidate'), activeUser('reviewer', 'admin')]
  });
  const service = createPinbaService({
    store, clock: () => new Date('2026-08-27T00:00:00.000Z'),
    driverCredentialSecret: 'synthetic-test-secret-value', driverReviewEnabled: false
  });
  const call = (action, data, actorId, key) => service.execute({ action, data, idempotencyKey: key }, { actorId });
  const documents = {};
  for (const kind of ['identityFront', 'driverLicense', 'vehicleExterior']) {
    const prepared = await call('driver.document.prepare', { kind }, 'candidate', `withdraw-${kind}-12345678`);
    const uploadReference = { uploadId: prepared.data.upload.id, fileID: `cloud://test/${prepared.data.upload.cloudPath}` };
    await call('driver.document.confirm', { kind, ...uploadReference }, 'candidate', `withdraw-confirm-${kind}-12345678`);
    documents[kind] = { uploadId: uploadReference.uploadId };
  }
  await call('driver.application.submit', driverPayload(documents), 'candidate', 'withdraw-submit-12345678');
  const review = await call('admin.driverApplication.review', { userId: 'candidate', decision: 'APPROVED' }, 'reviewer', 'production-review-12345678');
  assert.equal(review.ok, false);
  assert.equal(review.error.code, 'DRIVER_REVIEW_FORBIDDEN');
  const withdrawn = await call('driver.application.withdraw', {}, 'candidate', 'withdraw-action-12345678');
  assert.equal(withdrawn.data.application.status, 'WITHDRAWN');
  assert.equal(store.driverSecrets.get('candidate').status, 'RETENTION_PENDING');
  assert.ok([...store.driverDocumentUploads.values()].every((item) => item.status === 'RETENTION_PENDING'));
});
