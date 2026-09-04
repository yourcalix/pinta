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
const { decorateActivity } = require('../miniprogram/utils/display');

test('卡片按容量折叠真实头像，未知历史人数不生成头像或加号', () => {
  for (const [capacity, visible] of [[2, 2], [4, 4], [5, 3], [7, 3], [8, 2], [20, 2]]) {
    const base = { type: 'sport', status: 'RECRUITING', maxMembers: capacity, memberCount: capacity };
    const full = decorateActivity({ ...base, avatarSlots: Array.from({ length: capacity }, () => ({ kind: 'PASSENGER_A' })) });
    assert.equal(full.visibleAvatarSlots.length, visible);
    assert.equal(full.hiddenMemberCount, capacity - visible);
    const legacy = decorateActivity(base);
    assert.ok(legacy.visibleAvatarSlots.every((slot) => slot.empty));
    assert.equal(legacy.hiddenMemberCount, 0);
    assert.equal(legacy.memberCount, capacity);
  }
});

test('个人资料强制选择男或女且只映射为受控头像类型', () => {
  const base = { nickname: '测试用户', city: '澳门', interests: [], adultConfirmed: true };
  assert.throws(() => validateProfileInput(base), (error) => error.code === 'VALIDATION_ERROR');
  assert.equal(validateProfileInput({ ...base, gender: 'MALE' }).gender, 'MALE');
  assert.equal(validateProfileInput({ ...base, gender: 'FEMALE' }).gender, 'FEMALE');
  assert.equal(avatarKindFromGender('MALE'), 'PASSENGER_A');
  assert.equal(avatarKindFromGender('FEMALE'), 'PASSENGER_B');
  assert.equal(avatarKindFromGender('UNKNOWN'), null);
});

test('活动头像名册只公开受控头像类型并支持最多二十人容量', () => {
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
  const largeSlots = publicAvatarSlots(roster, 20);
  assert.equal(largeSlots.length, 20);
  assert.equal(largeSlots[19].kind, 'EMPTY');
});

test('前端未知头像一律降级为空位且资料头像按性别自动对应', () => {
  assert.match(profileAvatarPath('MALE'), /profile-avatar-male-painted\.webp$/);
  assert.match(profileAvatarPath('FEMALE'), /profile-avatar-female-painted\.webp$/);
  assert.match(profileAvatarPath(null), /profile-avatar-neutral-painted\.webp$/);
  const slots = normalizeAvatarSlots([{ kind: 'PASSENGER_A' }, { kind: 'UNTRUSTED' }], 7);
  assert.equal(slots.length, 7);
  assert.equal(slots[0].empty, false);
  assert.equal(slots[1].kind, 'EMPTY');
  assert.equal(slots[6].kind, 'EMPTY');
  assert.equal(normalizeAvatarSlots([], 20).length, 20);
});

test('资料页和我的页面使用真实性别选择与头像映射而非演示身份猜测', () => {
  const editWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/subpackages/profile/edit/index.wxml'), 'utf8');
  const editWxss = fs.readFileSync(path.join(ROOT, 'miniprogram/subpackages/profile/edit/index.wxss'), 'utf8');
  const editJs = fs.readFileSync(path.join(ROOT, 'miniprogram/subpackages/profile/edit/index.js'), 'utf8');
  const userJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/user/index.js'), 'utf8');
  const userWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/user/index.wxml'), 'utf8');
  const userWxss = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/user/index.wxss'), 'utf8');
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
  assert.match(userWxml, /shared-paper-bg\.webp/);
  assert.match(userWxml, /data-value="owned"[^>]*bindtap="handleMetricTap"/);
  assert.match(userWxml, /data-value="joined"[^>]*bindtap="handleMetricTap"/);
  assert.match(userWxml, /data-value="formed"[^>]*bindtap="handleMetricTap"/);
  assert.match(userWxss, /background:\s*#075aa7/);
  assert.match(userWxss, /padding-bottom:\s*calc\(140rpx \+ env\(safe-area-inset-bottom\)\)/);
  assert.doesNotMatch(userWxml, /喜欢散步|个人简介|个人签名/);
  assert.doesNotMatch(userJs, /u_driver|司机任务|司机认证/);
  assert.match(editWxml, /gender-options--error/);
});

test('我的页面统计项具备按压反馈且点击后联动活动列表', () => {
  const userWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/user/index.wxml'), 'utf8');
  const userWxss = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/user/index.wxss'), 'utf8');
  const userJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/user/index.js'), 'utf8');

  assert.equal((userWxml.match(/hover-class="metric-item--pressed"/g) || []).length, 3);
  assert.match(userWxss, /\.metric-item--pressed\s*{[\s\S]*transform:\s*scale\(0\.96\)/);
  assert.match(userJs, /handleMetricTap\(event\)[\s\S]*wx\.pageScrollTo\(\{ selector: '#my-activities', duration: 260 \}\)/);
});
