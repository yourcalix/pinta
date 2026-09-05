'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validateProfileInput } = require('../cloudfunctions/api/lib/validation');
const { createPinbaService, selfUser, publicActivity } = require('../cloudfunctions/api/lib/service');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');
const {
  getDaysInMonth,
  adultBirthLimit,
  buildBirthDatePicker,
  updateBirthDatePicker
} = require('../miniprogram/utils/profile-birth-date');

const NOW = new Date('2026-09-05T04:00:00.000Z');
const BASE_PROFILE = {
  nickname: '测试用户',
  gender: 'MALE',
  city: '澳门',
  interests: [],
  adultConfirmed: true
};

test('生日使用严格日历格式并正确验证闰年与18岁边界', () => {
  assert.equal(validateProfileInput({ ...BASE_PROFILE, birthDate: '2000-02-29' }, NOW).birthDate, '2000-02-29');
  assert.equal(validateProfileInput({ ...BASE_PROFILE, birthDate: '2008-09-05' }, NOW).birthDate, '2008-09-05');
  for (const birthDate of ['2001-02-29', '2000-13-01', '2000-04-31', '2000/01/01', '1899-12-31', '2008-09-06', '2027-01-01']) {
    assert.throws(
      () => validateProfileInput({ ...BASE_PROFILE, birthDate }, NOW),
      (error) => error.code === 'VALIDATION_ERROR' && error.details && error.details.field === 'birthDate'
    );
  }
  for (const birthDate of ['', null]) {
    assert.throws(
      () => validateProfileInput({ ...BASE_PROFILE, birthDate }, NOW),
      (error) => error.code === 'VALIDATION_ERROR' && error.details && error.details.field === 'birthDate'
    );
  }
});

test('18岁边界在澳门自然日零点切换而不是服务器UTC零点', () => {
  assert.deepEqual(adultBirthLimit(new Date('2026-09-04T15:59:59.000Z')), { year: 2008, month: 9, day: 4 });
  assert.deepEqual(adultBirthLimit(new Date('2026-09-04T16:00:00.000Z')), { year: 2008, month: 9, day: 5 });
  assert.throws(() => validateProfileInput({ ...BASE_PROFILE, birthDate: '2008-09-05' }, new Date('2026-09-04T15:59:59.000Z')));
  assert.equal(validateProfileInput({ ...BASE_PROFILE, birthDate: '2008-09-05' }, new Date('2026-09-04T16:00:00.000Z')).birthDate, '2008-09-05');
});

test('历史用户可无生日且旧客户端更新不会抹掉已有生日', async () => {
  const withoutBirthDate = validateProfileInput(BASE_PROFILE, NOW);
  assert.equal(Object.hasOwn(withoutBirthDate, 'birthDate'), false);

  const store = new MemoryStore({
    users: [{ id: 'self', role: 'user', status: 'ACTIVE', profile: { ...BASE_PROFILE, birthDate: '1998-06-12' } }]
  });
  const service = createPinbaService({ store, clock: () => new Date(NOW) });
  const result = await service.execute({
    action: 'profile.update',
    data: { ...BASE_PROFILE, nickname: '更新昵称' },
    idempotencyKey: 'profile-birthday-keep-001'
  }, { actorId: 'self' });
  assert.equal(result.ok, true);
  assert.equal(result.data.user.profile.birthDate, '1998-06-12');
  assert.equal((await store.getUser('self')).profile.birthDate, '1998-06-12');
});

test('完整生日只进入本人资料 DTO，不进入公开活动 DTO', () => {
  const privateDto = selfUser({ role: 'user', status: 'ACTIVE', profile: { ...BASE_PROFILE, birthDate: '1998-06-12' } });
  assert.equal(privateDto.profile.birthDate, '1998-06-12');
  const publicDto = publicActivity({
    id: 'activity-1', type: 'sport', title: '羽毛球', description: '', city: '澳门', district: '澳门城区',
    placeLabel: '体育馆', startsAt: '2026-09-06T10:00:00.000Z', deadlineAt: '2026-09-06T09:00:00.000Z',
    minMembers: 2, maxMembers: 4, targetMembers: 4, memberCount: 1, status: 'RECRUITING', rules: '',
    owner: { nickname: '发起人', birthDate: '1998-06-12' }, typeData: { sportType: '羽毛球', venue: '体育馆', level: 'ANY', intensity: 'LIGHT' }
  }, {}, NOW.toISOString());
  assert.equal(JSON.stringify(publicDto).includes('birthDate'), false);
  assert.equal(JSON.stringify(publicDto).includes('1998-06-12'), false);
});

test('生日滚轮限制成年上界并在大小月和闰年切换时夹紧日期', () => {
  assert.equal(getDaysInMonth(2000, 2), 29);
  assert.equal(getDaysInMonth(2001, 2), 28);
  const initial = buildBirthDatePicker('', NOW);
  assert.equal(initial.draft, '2000-01-01');
  assert.equal(initial.years.at(-1), 2008);

  const january31 = buildBirthDatePicker('2000-01-31', NOW);
  const february = updateBirthDatePicker(january31, [january31.yearIndex, 1, 30]);
  assert.equal(february.draft, '2000-02-29');

  const adultLimit = buildBirthDatePicker('2008-09-05', NOW);
  assert.equal(adultLimit.months.at(-1), 9);
  assert.equal(adultLimit.days.at(-1), 5);
});

test('个人资料页包含生日行、三列滚轮、隐私说明和滚动锁', () => {
  const root = path.join(__dirname, '../miniprogram/subpackages/profile/edit');
  const template = fs.readFileSync(path.join(root, 'index.wxml'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'index.wxss'), 'utf8');
  assert.match(template, /class="profile-row birthday-row"[^>]*bindtap="handleBirthdayOpen"/);
  assert.match(template, /<picker-view[^>]*bindchange="handleBirthdayChange"[^>]*bindpickstart="handleBirthdayPickStart"[^>]*bindpickend="handleBirthdayPickEnd"/);
  assert.equal((template.match(/<picker-view-column/g) || []).length, 3);
  assert.match(template, /仅用于年龄核验与活动匹配，不对外公开/);
  assert.doesNotMatch(template, /显示星座/);
  assert.match(script, /if \(form\.birthDate\) profileInput\.birthDate = form\.birthDate/);
  assert.match(style, /\.birthday-picker\s*{[^}]*height:\s*400rpx/);
  assert.match(style, /\.birthday-picker-item\s*{[^}]*height:\s*88rpx/);
});
