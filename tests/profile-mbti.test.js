'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validateProfileInput } = require('../cloudfunctions/api/lib/validation');
const { createPinbaService, selfUser, publicActivity } = require('../cloudfunctions/api/lib/service');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');

const ROOT = path.join(__dirname, '../miniprogram/subpackages/profile/edit');
const PAGE_PATH = require.resolve('../miniprogram/subpackages/profile/edit/index');
const NOW = new Date('2026-09-06T04:00:00.000Z');
const PROFILE = { nickname: '测试用户', gender: 'MALE', city: '澳门', interests: [], adultConfirmed: true };
const MBTI_TYPES = [
  'INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP',
  'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP'
];

function applyPatch(data, patch) {
  for (const [key, value] of Object.entries(patch)) {
    const parts = key.split('.');
    let target = data;
    for (let index = 0; index < parts.length - 1; index += 1) target = target[parts[index]];
    target[parts.at(-1)] = value;
  }
}

function loadPage() {
  let definition;
  const timers = [];
  const previous = { Page: global.Page, wx: global.wx, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
  global.Page = (value) => { definition = value; };
  global.wx = { hideKeyboard() {} };
  global.setTimeout = (callback) => { const timer = { callback, cancelled: false }; timers.push(timer); return timer; };
  global.clearTimeout = (timer) => { if (timer) timer.cancelled = true; };
  delete require.cache[PAGE_PATH];
  require(PAGE_PATH);
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch) { applyPatch(this.data, patch); }
  };
  page.data.loading = false;
  return {
    page,
    flushTimers() { for (const timer of timers.splice(0)) if (!timer.cancelled) timer.callback(); },
    cleanup() {
      delete require.cache[PAGE_PATH];
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete global[key]; else global[key] = value;
      }
    }
  };
}

test('MBTI 仅接受 16 种标准类型并支持主动清空', () => {
  for (const mbti of MBTI_TYPES) assert.equal(validateProfileInput({ ...PROFILE, mbti }).mbti, mbti);
  assert.equal(validateProfileInput({ ...PROFILE, mbti: ' infp ' }).mbti, 'INFP');
  assert.equal(validateProfileInput({ ...PROFILE, mbti: '' }).mbti, null);
  assert.equal(validateProfileInput({ ...PROFILE, mbti: null }).mbti, null);
  assert.equal(Object.hasOwn(validateProfileInput(PROFILE), 'mbti'), false);
  assert.equal(Object.hasOwn(validateProfileInput({ ...PROFILE, mbti: undefined }), 'mbti'), false);
  for (const mbti of ['ABCD', 'INT', 123, {}]) {
    assert.throws(
      () => validateProfileInput({ ...PROFILE, mbti }),
      (error) => error.code === 'VALIDATION_ERROR' && error.details && error.details.field === 'mbti'
    );
  }
});

test('旧客户端更新保留 MBTI，新客户端可修改或清空', async () => {
  const store = new MemoryStore({ users: [{ id: 'self', role: 'user', status: 'ACTIVE', profile: { ...PROFILE, mbti: 'ENFP' } }] });
  const service = createPinbaService({ store, clock: () => new Date(NOW) });
  const execute = (data, key) => service.execute({ action: 'profile.update', data, idempotencyKey: key }, { actorId: 'self' });

  let result = await execute({ ...PROFILE, nickname: '旧端更新' }, 'profile-mbti-keep-001');
  assert.equal(result.data.user.profile.mbti, 'ENFP');
  result = await execute({ ...PROFILE, nickname: '显式未定义', mbti: undefined }, 'profile-mbti-undefined-002');
  assert.equal(result.data.user.profile.mbti, 'ENFP');
  result = await execute({ ...PROFILE, nickname: '修改类型', mbti: 'istj' }, 'profile-mbti-set-003');
  assert.equal(result.data.user.profile.mbti, 'ISTJ');
  result = await execute({ ...PROFILE, nickname: '清空类型', mbti: null }, 'profile-mbti-clear-004');
  assert.equal(result.data.user.profile.mbti, null);
  assert.equal((await store.getUser('self')).profile.mbti, null);
});

test('MBTI 只进入本人资料，不进入公开活动 DTO', () => {
  const privateDto = selfUser({ role: 'user', status: 'ACTIVE', profile: { ...PROFILE, mbti: 'ENFJ' } });
  assert.equal(privateDto.profile.mbti, 'ENFJ');
  const publicDto = publicActivity({
    id: 'activity-1', type: 'sport', title: '羽毛球', description: '', city: '澳门', district: '澳门城区',
    placeLabel: '体育馆', startsAt: '2026-09-07T10:00:00.000Z', deadlineAt: '2026-09-07T09:00:00.000Z',
    minMembers: 2, maxMembers: 4, targetMembers: 4, memberCount: 1, status: 'RECRUITING', rules: '',
    owner: { nickname: '发起人', mbti: 'ENFJ' }, typeData: { sportType: '羽毛球', venue: '体育馆', level: 'ANY', intensity: 'LIGHT' }
  }, {}, NOW.toISOString());
  assert.equal(JSON.stringify(publicDto).includes('mbti'), false);
  assert.equal(JSON.stringify(publicDto).includes('ENFJ'), false);
});

test('MBTI 行与四列选择抽屉符合草稿保存边界', () => {
  const template = fs.readFileSync(path.join(ROOT, 'index.wxml'), 'utf8');
  const script = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
  const style = fs.readFileSync(path.join(ROOT, 'index.wxss'), 'utf8');
  assert.match(template, /birthday-row[\s\S]*mbti-row[\s\S]*cover-row/);
  assert.match(template, /wx:if="\{\{mbtiSheetMounted\}\}"[^>]*catchtouchmove="preventScroll"/);
  assert.match(template, /wx:for="\{\{mbtiOptions\}\}"[^>]*bindtap="handleMbtiSelect"/);
  assert.match(template, /bindtap="handleMbtiClear"[^>]*>暂不设置 MBTI/);
  assert.match(style, /\.mbti-grid\s*{[^}]*grid-template-columns:\s*repeat\(4/);
  assert.match(style, /\.mbti-option--selected\s*{[^}]*border-color:\s*#16a36a/);
  assert.match(script, /mbti:\s*form\.mbti \|\| null/);
  const selectionHandlers = script.match(/handleMbtiSelect\(event\) \{([\s\S]*?)\n  \},[\s\S]*?handleMbtiConfirm\(\) \{([\s\S]*?)\n  \},/);
  assert.doesNotMatch(selectionHandlers[0], /userService\./);
});

test('MBTI 抽屉取消丢弃草稿，确定仅回填编辑表单', () => {
  const context = loadPage();
  try {
    const { page } = context;
    page.data.form.mbti = 'INTJ';
    page.handleMbtiOpen();
    assert.equal(page.data.mbtiDraft, 'INTJ');
    page.handleMbtiSelect({ currentTarget: { dataset: { value: 'ENFP' } } });
    assert.equal(page.data.form.mbti, 'INTJ');
    page.handleMbtiClose();
    context.flushTimers();
    assert.equal(page.data.form.mbti, 'INTJ');

    page.handleMbtiOpen();
    page.handleMbtiSelect({ currentTarget: { dataset: { value: 'ENFP' } } });
    page.handleMbtiConfirm();
    assert.equal(page.data.form.mbti, 'ENFP');
    page.handleMbtiOpen();
    page.handleMbtiClear();
    page.handleMbtiConfirm();
    assert.equal(page.data.form.mbti, '');
  } finally {
    context.cleanup();
  }
});

test('Mock 资料契约同步实现 MBTI 的校验、保留与本人 DTO 输出', async (t) => {
  const source = fs.readFileSync(path.join(__dirname, '../miniprogram/mocks/server.js'), 'utf8');
  assert.match(source, /const USER_MBTI_TYPES = Object\.freeze/);
  assert.match(source, /Object\.prototype\.hasOwnProperty\.call\(input, 'mbti'\)/);
  assert.match(source, /profile\.mbti = currentProfile\.mbti/);
  assert.match(source, /mbti: user\.profile\.mbti \|\| null/);

  const mock = require('../miniprogram/mocks/server');
  mock.reset();
  t.after(() => mock.reset());
  const base = (await mock.call({ action: 'profile.get', data: {} })).data.user.profile;
  const input = { nickname: base.nickname, gender: base.gender, city: base.city, interests: base.interests, adultConfirmed: true };
  let result = await mock.call({ action: 'profile.update', data: { ...input, mbti: 'enfp' }, idempotencyKey: 'mock-mbti-set-001' });
  assert.equal(result.data.user.profile.mbti, 'ENFP');
  result = await mock.call({ action: 'profile.update', data: { ...input, nickname: '保留测试', mbti: undefined }, idempotencyKey: 'mock-mbti-keep-002' });
  assert.equal(result.data.user.profile.mbti, 'ENFP');
  result = await mock.call({ action: 'profile.update', data: { ...input, nickname: '清空测试', mbti: '' }, idempotencyKey: 'mock-mbti-clear-003' });
  assert.equal(result.data.user.profile.mbti, null);
});
