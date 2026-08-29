'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validateProfileInput } = require('../cloudfunctions/api/lib/validation');
const {
  avatarKindFromGender,
  publicAvatarSlots,
  upsertAvatarRoster,
  removeAvatarRosterMember
} = require('../cloudfunctions/api/lib/passenger-avatar');
const {
  profileAvatarPath,
  normalizeAvatarSlots
} = require('../miniprogram/utils/passenger-avatar');

const ROOT = path.join(__dirname, '..');

test('个人资料强制选择男或女且只映射为受控头像类型', () => {
  const base = { nickname: '测试用户', city: '澳门', interests: [], adultConfirmed: true };
  assert.throws(() => validateProfileInput(base), (error) => error.code === 'VALIDATION_ERROR');
  assert.equal(validateProfileInput({ ...base, gender: 'MALE' }).gender, 'MALE');
  assert.equal(validateProfileInput({ ...base, gender: 'FEMALE' }).gender, 'FEMALE');
  assert.equal(avatarKindFromGender('MALE'), 'PASSENGER_A');
  assert.equal(avatarKindFromGender('FEMALE'), 'PASSENGER_B');
  assert.equal(avatarKindFromGender('UNKNOWN'), null);
});

test('公开拼车头像槽位固定为七个且不暴露成员标识或原始性别', () => {
  let roster = upsertAvatarRoster([], 'member-owner', 'PASSENGER_A');
  roster = upsertAvatarRoster(roster, 'member-guest', 'PASSENGER_B');
  const slots = publicAvatarSlots(roster, 7);
  assert.deepEqual(slots.map((slot) => slot.kind), [
    'PASSENGER_A', 'PASSENGER_B', 'EMPTY', 'EMPTY', 'EMPTY', 'EMPTY', 'EMPTY'
  ]);
  assert.equal(JSON.stringify(slots).includes('member-owner'), false);
  assert.equal(JSON.stringify(slots).includes('gender'), false);
  assert.deepEqual(removeAvatarRosterMember(roster, 'member-owner'), [
    { memberId: 'member-guest', avatarKind: 'PASSENGER_B' }
  ]);
});

test('前端未知头像一律降级为空位且资料头像按性别自动对应', () => {
  assert.match(profileAvatarPath('MALE'), /avatar-passenger-a\.png$/);
  assert.match(profileAvatarPath('FEMALE'), /avatar-passenger-b\.png$/);
  assert.match(profileAvatarPath(null), /avatar-passenger-empty\.png$/);
  const slots = normalizeAvatarSlots([{ kind: 'PASSENGER_A' }, { kind: 'UNTRUSTED' }], 7);
  assert.equal(slots.length, 7);
  assert.equal(slots[0].empty, false);
  assert.equal(slots[1].kind, 'EMPTY');
  assert.equal(slots[6].kind, 'EMPTY');
});

test('资料页和我的页面使用真实性别选择与头像映射而非演示身份猜测', () => {
  const editWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/subpackages/profile/edit/index.wxml'), 'utf8');
  const editJs = fs.readFileSync(path.join(ROOT, 'miniprogram/subpackages/profile/edit/index.js'), 'utf8');
  const userJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/user/index.js'), 'utf8');
  const publishJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/publish/index.js'), 'utf8');
  const detailJs = fs.readFileSync(path.join(ROOT, 'miniprogram/subpackages/activity/detail/index.js'), 'utf8');
  assert.match(editWxml, /data-gender="MALE"/);
  assert.match(editWxml, /data-gender="FEMALE"/);
  assert.match(editWxml, /role="radiogroup"/);
  assert.match(editJs, /gender: form\.gender/);
  assert.match(userJs, /profileAvatarPath\(user\.profile && user\.profile\.gender\)/);
  assert.doesNotMatch(userJs, /getMockPersona\(\) === 'u_member'/);
  assert.match(editWxml, /gender-options--error/);
  assert.match(publishJs, /请先完善性别资料/);
  assert.match(detailJs, /请先完善性别资料/);
});
