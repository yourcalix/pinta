'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const studentAccess = require('../miniprogram/utils/student-access');

test('学生认证前端门禁只放行 APPROVED 并按状态引导认证', async () => {
  const modalCalls = [];
  const navigationCalls = [];
  global.wx = {
    showModal(options) {
      modalCalls.push(options);
      options.success({ confirm: true });
    },
    navigateTo(options) { navigationCalls.push(options); }
  };
  try {
    const approved = await studentAccess.ensureStudentVerified({
      getStudentVerification: async () => ({ verification: { status: 'APPROVED' } })
    }, '发布校园拼车');
    assert.equal(approved, true);
    assert.equal(modalCalls.length, 0);

    const pending = await studentAccess.ensureStudentVerified({
      getStudentVerification: async () => ({ verification: { status: 'SUBMITTED' } })
    }, '加入校园拼车');
    assert.equal(pending, false);
    assert.equal(modalCalls[0].title, '校园学生认证审核中');
    assert.equal(navigationCalls[0].url, '/subpackages/profile/student/index');
  } finally {
    delete global.wx;
  }
});

test('稳定门禁错误码会转为学生认证引导，其他错误保持原处理链', () => {
  let shown = false;
  global.wx = {
    showModal() { shown = true; },
    navigateTo() {}
  };
  try {
    assert.equal(studentAccess.handleStudentVerificationError({ code: 'STUDENT_VERIFICATION_REQUIRED' }, '发布校园拼车'), true);
    assert.equal(shown, true);
    assert.equal(studentAccess.handleStudentVerificationError({ code: 'TIMEOUT' }, '发布校园拼车'), false);
  } finally {
    delete global.wx;
  }
});

test('学生门禁只接入发布与加入，司机认证和承接使用独立资格线', () => {
  const root = path.resolve(__dirname, '../miniprogram');
  const publishEntry = fs.readFileSync(path.join(root, 'pages/publish/index.js'), 'utf8');
  const rideDetail = fs.readFileSync(path.join(root, 'subpackages/activity/detail/index.js'), 'utf8');
  const publishForm = fs.readFileSync(path.join(root, 'subpackages/publish/form/index.js'), 'utf8');
  const driverPage = fs.readFileSync(path.join(root, 'subpackages/profile/driver/index.js'), 'utf8');
  const driverTemplate = fs.readFileSync(path.join(root, 'subpackages/profile/driver/index.wxml'), 'utf8');
  const studentPage = fs.readFileSync(path.join(root, 'subpackages/profile/student/index.js'), 'utf8');

  assert.match(publishEntry, /ensureStudentVerified\(userService, '发布或加入拼车'\)/);
  assert.match(rideDetail, /ensureStudentVerified\(userService, '加入校园拼车'\)/);
  assert.match(rideDetail, /DRIVER_NOT_APPROVED/);
  assert.match(publishForm, /handleStudentVerificationError\(error, '发布校园拼车'\)/);
  assert.doesNotMatch(driverPage, /getStudentVerification|isApprovedStudent|studentVerificationRequired/);
  assert.doesNotMatch(driverTemplate, /先完成校园学生认证|才可继续申请司机与车辆认证/);
  assert.doesNotMatch(rideDetail, /handleStudentVerificationError\(error, '申请司机认证并承接行程'\)/);
  assert.doesNotMatch(studentPage, /承接行程仍需另行完成司机与车辆认证/);
});
