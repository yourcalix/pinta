'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPinbaService } = require('../cloudfunctions/api/lib/service');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');
const { validateStudentVerificationInput } = require('../cloudfunctions/api/lib/validation');
const mockServer = require('../miniprogram/mocks/server');

const NOW = new Date('2026-08-23T02:00:00.000Z');

function activeUser(id, role = 'user') {
  return {
    id,
    role,
    status: 'ACTIVE',
    profile: { nickname: id, gender: 'MALE', city: '澳门', interests: [], adultConfirmed: true },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString()
  };
}

function setup(options = {}) {
  const store = new MemoryStore({ users: [activeUser('student'), activeUser('other'), activeUser('admin', 'admin')] });
  const service = createPinbaService({
    store,
    clock: () => new Date(NOW),
    studentCredentialSecret: 'student-test-secret-2026',
    studentVerificationAutoApprove: options.autoApprove === true,
    studentReviewEnabled: true,
    studentAutoApprovalEnvironment: options.autoApproveEnvironment || (options.autoApprove ? 'test' : '')
  });
  let request = 0;
  return {
    store,
    call(action, data = {}, actorId = 'student', key) {
      request += 1;
      return service.execute({
        action,
        data,
        requestId: `student-request-${request}`,
        ...(key ? { idempotencyKey: key } : {})
      }, { actorId });
    }
  };
}

async function prepareCard(call) {
  const prepared = await call('student.document.prepare', { kind: 'studentCardFront' }, 'student', 'student-prepare-1');
  assert.equal(prepared.ok, true);
  const upload = prepared.data.upload;
  const confirmed = await call('student.document.confirm', {
    kind: 'studentCardFront',
    uploadId: upload.id,
    fileID: upload.cloudPath
  }, 'student', 'student-confirm-1');
  assert.equal(confirmed.ok, true);
  return confirmed.data.document.uploadId;
}

test('没有学生认证事实时只锁定学生侧 Dashboard，司机资格线独立判定', async () => {
  const { call } = setup();
  const status = await call('student.verification.get');
  assert.deepEqual(status.data.verification, {
    status: 'NOT_SUBMITTED',
    revision: 0,
    summary: null,
    review: null,
    submittedAt: null,
    updatedAt: null
  });
  for (const action of ['activity.mine', 'notification.list']) {
    const result = await call(action);
    assert.equal(result.ok, false, action);
    assert.equal(result.error.code, 'STUDENT_VERIFICATION_REQUIRED', action);
  }
  const driverProfile = await call('ride.driver.profile');
  assert.equal(driverProfile.ok, true);
  assert.equal(driverProfile.data.driver.canAcceptRide, false);
  const driverMine = await call('ride.driver.mine');
  assert.equal(driverMine.ok, false);
  assert.equal(driverMine.error.code, 'DRIVER_NOT_APPROVED');
});

test('普通登录用户发布与加入需要学生认证，但可独立申请司机认证', async () => {
  const { call } = setup();
  const studentGuardedActions = [
    ['activity.create', {}, 'create-without-student'],
    ['ride.join', {}, 'join-without-student']
  ];
  for (const [action, data, key] of studentGuardedActions) {
    const result = await call(action, data, 'student', key);
    assert.equal(result.ok, false, action);
    assert.equal(result.error.code, 'STUDENT_VERIFICATION_REQUIRED', action);
  }
  assert.equal((await call('driver.application.get')).ok, true);
  assert.equal((await call('driver.document.prepare', { kind: 'identityFront' }, 'student', 'driver-document-without-student')).ok, true);
  const invalidDriverSubmit = await call('driver.application.submit', {}, 'student', 'driver-submit-without-student');
  assert.equal(invalidDriverSubmit.ok, false);
  assert.notEqual(invalidDriverSubmit.error.code, 'STUDENT_VERIFICATION_REQUIRED');
});

test('学生认证待审或被拒绝时只限制学生能力，不阻断司机申请入口', async () => {
  for (const status of ['SUBMITTED', 'NEEDS_MORE_INFO', 'REJECTED']) {
    const { call, store } = setup();
    store.studentVerifications.set('student', {
      id: 'student', userId: 'student', status, revision: 1, updatedAt: NOW.toISOString()
    });
    for (const [action, data, key] of [
      ['activity.mine', {}, null],
      ['activity.create', {}, `create-${status}`],
      ['ride.join', {}, `join-${status}`]
    ]) {
      const result = await call(action, data, 'student', key);
      assert.equal(result.ok, false, `${status}:${action}`);
      assert.equal(result.error.code, 'STUDENT_VERIFICATION_REQUIRED', `${status}:${action}`);
    }
    assert.equal((await call('driver.application.get')).ok, true, `${status}:driver.application.get`);
    assert.equal((await call('driver.document.prepare', { kind: 'identityFront' }, 'student', `driver-prepare-${status}`)).ok, true, `${status}:driver.document.prepare`);
    const driverMine = await call('ride.driver.mine');
    assert.equal(driverMine.ok, false, `${status}:ride.driver.mine`);
    assert.equal(driverMine.error.code, 'DRIVER_NOT_APPROVED', `${status}:ride.driver.mine`);
  }
});

test('学生认证通过只解锁学生能力，司机私域任务仍要求司机资格通过', async () => {
  const { call, store } = setup();
  store.studentVerifications.set('student', {
    id: 'student', userId: 'student', status: 'APPROVED', revision: 1, updatedAt: NOW.toISOString()
  });
  assert.equal((await call('activity.mine')).ok, true);
  assert.equal((await call('ride.driver.profile')).data.driver.canAcceptRide, false);
  const driverMine = await call('ride.driver.mine');
  assert.equal(driverMine.ok, false);
  assert.equal(driverMine.error.code, 'DRIVER_NOT_APPROVED');
});

test('已通过司机资格不因学生认证失效而降权', async () => {
  const { call, store } = setup();
  store.studentVerifications.set('student', {
    id: 'student', userId: 'student', status: 'APPROVED', revision: 1, updatedAt: NOW.toISOString()
  });
  store.drivers.set('student', {
    id: 'student', userId: 'student', status: 'ACTIVE', reviewStatus: 'APPROVED'
  });
  store.vehicles.set('vehicle-student', {
    id: 'vehicle-student', driverId: 'student', status: 'ACTIVE', reviewStatus: 'APPROVED',
    type: '七座轿车', plateMasked: '***28', passengerCapacity: 7
  });
  assert.equal((await call('ride.driver.mine')).ok, true);

  store.studentVerifications.get('student').status = 'REJECTED';
  const profile = await call('ride.driver.profile');
  assert.equal(profile.ok, true);
  assert.equal(profile.data.driver.canAcceptRide, true);
  assert.equal((await call('ride.driver.mine')).ok, true);
  assert.equal((await call('driver.application.get')).ok, true);
  assert.equal((await call('activity.mine')).error.code, 'STUDENT_VERIFICATION_REQUIRED');
});

test('Mock 审核通过司机无需学生认证即可读取司机资格与任务', async () => {
  mockServer.reset();
  assert.equal(mockServer.setPersona('u_driver'), true);
  const studentStatus = await mockServer.call({ action: 'student.verification.get', data: {} });
  assert.equal(studentStatus.data.verification.status, 'NOT_SUBMITTED');
  const profile = await mockServer.call({ action: 'ride.driver.profile', data: {} });
  assert.equal(profile.ok, true);
  assert.equal(profile.data.driver.canAcceptRide, true);
  assert.equal((await mockServer.call({ action: 'ride.driver.mine', data: {} })).ok, true);
  assert.equal((await mockServer.call({ action: 'activity.mine', data: {} })).error.code, 'STUDENT_VERIFICATION_REQUIRED');
  mockServer.reset();
});

test('学生认证提交只回显脱敏学号且开发显式开关可自动通过', async () => {
  const { call, store } = setup({ autoApprove: true });
  const uploadId = await prepareCard(call);
  const result = await call('student.verification.submit', {
    schoolName: '拼吧大学',
    studentNumber: 'PB-2026-123456',
    documents: { studentCardFront: { uploadId } },
    consent: { privacyVersion: 'student-verification-v1', studentVerify: true, sensitiveDocuments: true }
  }, 'student', 'student-submit-1');
  assert.equal(result.ok, true);
  assert.equal(result.data.verification.status, 'APPROVED');
  assert.equal(result.data.verification.summary.schoolName, '拼吧大学');
  assert.equal(result.data.verification.summary.schoolLabel, '拼吧大学');
  assert.equal(Object.hasOwn(result.data.verification.summary, 'schoolId'), false);
  assert.equal(result.data.verification.summary.studentNumberMasked, '********3456');
  assert.equal(JSON.stringify(result.data).includes('PB-2026-123456'), false);
  assert.equal(JSON.stringify(result.data).includes('private-student'), false);
  assert.equal(store.studentVerificationSecrets.get('student').studentNumber.enc.ciphertext.length > 0, true);
  assert.equal(JSON.stringify(store.studentVerifications.get('student')).includes('PB-2026-123456'), false);
  assert.equal((await call('activity.mine')).ok, true);
});

test('生产环境即使误开自动审核开关也保持人工审核门禁', async () => {
  const { call } = setup({ autoApprove: true, autoApproveEnvironment: 'production' });
  const uploadId = await prepareCard(call);
  const result = await call('student.verification.submit', {
    schoolName: '拼吧大学',
    studentNumber: 'PROD20260001',
    documents: { studentCardFront: { uploadId } },
    consent: { privacyVersion: 'student-verification-v1', studentVerify: true, sensitiveDocuments: true }
  }, 'student', 'student-submit-production');
  assert.equal(result.data.verification.status, 'SUBMITTED');
  assert.equal((await call('activity.mine')).error.code, 'STUDENT_VERIFICATION_REQUIRED');
});

test('其他用户不能确认或绑定不属于自己的学生证件上传', async () => {
  const { call } = setup();
  const prepared = await call('student.document.prepare', { kind: 'studentCardFront' }, 'student', 'student-owned-upload');
  const upload = prepared.data.upload;
  const crossUser = await call('student.document.confirm', {
    kind: 'studentCardFront', uploadId: upload.id, fileID: upload.cloudPath
  }, 'other', 'other-confirm-owned-upload');
  assert.equal(crossUser.ok, false);
  assert.equal(crossUser.error.code, 'STUDENT_DOCUMENT_REQUIRED');
});

test('生产式人工审核前持续锁定，审核通过后才解锁', async () => {
  const { call } = setup();
  const uploadId = await prepareCard(call);
  const submitted = await call('student.verification.submit', {
    schoolName: '校园理工学院',
    studentNumber: 'S20260088',
    documents: { studentCardFront: { uploadId } },
    consent: { privacyVersion: 'student-verification-v1', studentVerify: true, sensitiveDocuments: true }
  }, 'student', 'student-submit-2');
  assert.equal(submitted.data.verification.status, 'SUBMITTED');
  assert.equal((await call('activity.mine')).error.code, 'STUDENT_VERIFICATION_REQUIRED');
  const approved = await call('admin.studentVerification.review', {
    userId: 'student', decision: 'APPROVED', reasonCode: ''
  }, 'admin', 'student-review-1');
  assert.equal(approved.data.verification.status, 'APPROVED');
  assert.equal((await call('activity.mine')).ok, true);
});

test('学生认证页面和我的页使用受控状态与锁定占位，不展示伪零统计', () => {
  const root = path.resolve(__dirname, '../miniprogram');
  const userTemplate = fs.readFileSync(path.join(root, 'pages/user/index.wxml'), 'utf8');
  const userScript = fs.readFileSync(path.join(root, 'pages/user/index.js'), 'utf8');
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  assert.match(userTemplate, /校园学生认证/);
  assert.match(userTemplate, /wx:if="\{\{dashboardMode === 'rides'\}\}"[\s\S]*student-verification-card/);
  assert.match(userTemplate, /studentVerified/);
  assert.match(userTemplate, /行程与统计已锁定/);
  assert.match(userTemplate, /dashboardMode === 'driver'/);
  assert.match(userTemplate, /student-verification-card--compact/);
  assert.match(userTemplate, /认证服务正在升级/);
  assert.match(userTemplate, /个人行程与账号数据完好/);
  assert.match(userTemplate, /disabled="\{\{loading\}\}"/);
  assert.match(userTemplate, /dashboardMode === 'rides'/);
  assert.match(userTemplate, /司机认证状态暂不可用/);
  assert.match(userTemplate, /role="region"/);
  assert.match(userScript, /getStudentVerification/);
  assert.match(userScript, /studentVerified/);
  assert.doesNotMatch(userScript, /并继续申请司机认证/);
  assert.doesNotMatch(userScript, /已解锁个人行程、统计与司机任务/);
  assert.match(userScript, /isStudentVerificationActionUnavailable/);
  assert.match(userScript, /studentVerificationAvailable: verificationAvailable/);
  assert.match(userScript, /if \(!this\.data\.studentVerificationAvailable\)/);
  assert.match(userScript, /ACTION_NOT_FOUND/);
  assert.match(userScript, /error\.message \|\| error\.errMsg/);
  assert.match(userScript, /_studentVerificationReloading/);
  assert.doesNotMatch(userScript, /setStorageSync\([^\n]*studentNumber/);
  const studentPageScript = fs.readFileSync(path.join(root, 'subpackages/profile/student/index.js'), 'utf8');
  const studentPageTemplate = fs.readFileSync(path.join(root, 'subpackages/profile/student/index.wxml'), 'utf8');
  const studentDocumentService = fs.readFileSync(path.join(root, 'services/student-documents.js'), 'utf8');
  assert.doesNotMatch(studentPageScript, /setStorageSync/);
  assert.doesNotMatch(studentDocumentService, /setStorageSync/);
  assert.match(studentPageTemplate, /已上传，点击可重新选择/);
  assert.match(studentPageTemplate, /所属学校/);
  assert.match(studentPageTemplate, /form\.schoolName/);
  assert.match(studentPageTemplate, /请填写学生证或校园卡上的学校全称/);
  assert.doesNotMatch(studentPageTemplate, /picker|所属校区/);
  assert.match(studentPageScript, /schoolName/);
  assert.doesNotMatch(studentPageScript, /SCHOOLS|schoolIndex|form\.schoolId/);
  const cloudEntry = fs.readFileSync(path.resolve(__dirname, '../cloudfunctions/api/index.js'), 'utf8');
  assert.match(cloudEntry, /ENABLE_STUDENT_REVIEW !== 'false'/);
  assert.match(cloudEntry, /isStudentDevelopmentEnvironment \? process\.env\.DRIVER_CREDENTIAL_SECRET/);
  const profilePackage = app.subPackages.find((item) => item.root === 'subpackages/profile');
  assert.ok(profilePackage.pages.includes('student/index'));
});

test('学生认证学校名称自由输入受控校验且历史校区记录可继续回显', async () => {
  const { call, store } = setup();
  for (const schoolName of ['', '学', 'https://example.com', 'ftp://example.com', 'example.com/path', '<学校>', '＜学校＞', '学'.repeat(61)]) {
    const result = await call('student.verification.submit', {
      schoolName,
      studentNumber: 'S20260001',
      documents: {},
      consent: { privacyVersion: 'student-verification-v1', studentVerify: true, sensitiveDocuments: true }
    }, 'student', `invalid-school-${schoolName.length}`);
    assert.equal(result.ok, false, schoolName);
    assert.equal(result.error.code, 'VALIDATION_ERROR', schoolName);
  }

  const staleSchoolId = await call('student.verification.submit', {
    schoolId: 'TAIPA_CAMPUS',
    schoolName: '拼吧大学',
    studentNumber: 'S20260001',
    documents: {},
    consent: { privacyVersion: 'student-verification-v1', studentVerify: true, sensitiveDocuments: true }
  }, 'student', 'stale-school-id');
  assert.equal(staleSchoolId.ok, false);
  assert.equal(staleSchoolId.error.code, 'VALIDATION_ERROR');

  const normalized = validateStudentVerificationInput({
    schoolName: `拼${' '.repeat(61)}吧大学`,
    studentNumber: 'S20260001',
    documents: { studentCardFront: { uploadId: 'upload-normalized' } },
    consent: { privacyVersion: 'student-verification-v1', studentVerify: true, sensitiveDocuments: true }
  });
  assert.equal(normalized.schoolName, '拼 吧大学');

  store.studentVerifications.set('student', {
    id: 'student', userId: 'student', status: 'APPROVED', revision: 1,
    summary: { schoolId: 'TAIPA_CAMPUS', studentNumberMasked: '******0001', documentKinds: ['studentCardFront'] },
    review: null, submittedAt: NOW.toISOString(), updatedAt: NOW.toISOString()
  });
  const legacy = await call('student.verification.get');
  assert.equal(legacy.ok, true);
  assert.equal(legacy.data.verification.summary.schoolLabel, '凼仔校区');
  assert.equal(legacy.data.verification.summary.schoolId, 'TAIPA_CAMPUS');
});
