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

test.skip('旧固定七人拼车头像槽位工具已退出新活动主链路', () => {
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
  const editWxss = fs.readFileSync(path.join(ROOT, 'miniprogram/subpackages/profile/edit/index.wxss'), 'utf8');
  const editJs = fs.readFileSync(path.join(ROOT, 'miniprogram/subpackages/profile/edit/index.js'), 'utf8');
  const userJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/user/index.js'), 'utf8');
  assert.match(editWxml, /data-gender="MALE"/);
  assert.match(editWxml, /data-gender="FEMALE"/);
  assert.match(editWxml, /role="radiogroup"/);
  assert.match(editWxml, /hero-campus\.png/);
  assert.doesNotMatch(editWxml, /ride-car-green\.png|driver-role-voxel\.png|我是司机/);
  assert.match(editWxml, /兴趣标签<\/text>\s*<text class="optional-label">（选填）/);
  assert.doesNotMatch(editWxml, /所在城市|澳门|澳門/);
  assert.match(editWxss, /@media \(max-width: 340px\)/);
  assert.match(editWxss, /\.gender-options[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(editJs, /gender: form\.gender/);
  assert.match(editJs, /city: PILOT_CITY/);
  assert.match(userJs, /profileAvatarPath: profileAvatarPath\(user\.profile && user\.profile\.gender\)/);
  assert.doesNotMatch(userJs, /u_driver|司机任务|司机认证/);
  assert.match(editWxml, /gender-options--error/);
});
