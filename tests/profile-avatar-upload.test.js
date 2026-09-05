'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPinbaService, selfUser } = require('../cloudfunctions/api/lib/service');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');
const { createLocalModeration, createWechatModeration } = require('../cloudfunctions/api/lib/moderation');
const { inspectProfileAvatar } = require('../cloudfunctions/api/lib/profile-avatar');
const EDIT_PAGE_PATH = require.resolve('../miniprogram/subpackages/profile/edit/index');

const PROFILE = { nickname: '小拼', gender: 'MALE', city: '澳门', interests: [], adultConfirmed: true };

function pngHeader(width, height) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function harness() {
  const store = new MemoryStore({ users: [{ id: 'u1', role: 'user', status: 'ACTIVE', profile: PROFILE }] });
  let sequence = 0;
  const service = createPinbaService({ store, moderation: createLocalModeration(), idGenerator: () => `avatar_${++sequence}`, clock: () => new Date('2026-09-05T12:00:00.000Z') });
  const call = async (action, data = {}) => service.execute({ action, data, idempotencyKey: `test_key_${++sequence}` }, { actorId: 'u1' });
  return { store, call };
}

function applyPagePatch(data, patch) {
  Object.entries(patch).forEach(([key, value]) => {
    const parts = key.split('.');
    let target = data;
    for (let index = 0; index < parts.length - 1; index += 1) target = target[parts[index]];
    target[parts[parts.length - 1]] = value;
  });
}

test('头像图片校验限制格式、体积与尺寸', () => {
  assert.deepEqual(inspectProfileAvatar(pngHeader(512, 512)), { format: 'png', contentType: 'image/png', width: 512, height: 512, byteLength: 24 });
  assert.throws(() => inspectProfileAvatar(Buffer.from('not-image')), (error) => error.code === 'PROFILE_AVATAR_INVALID');
  assert.throws(() => inspectProfileAvatar(pngHeader(64, 64)), (error) => error.code === 'PROFILE_AVATAR_INVALID');
});

test('生产图片审核只接受微信明确返回 pass', async () => {
  const accepted = createWechatModeration({ openapi: { security: { imgSecCheck: async () => ({ errCode: 0, result: { suggest: 'pass' } }) } } }, { enabled: true, production: true });
  assert.equal((await accepted.checkImage(Buffer.from('image'), { actorId: 'u1' })).provider, 'wechat');

  const unknown = createWechatModeration({ openapi: { security: { imgSecCheck: async () => ({ errCode: 0 }) } } }, { enabled: true, production: true });
  await assert.rejects(() => unknown.checkImage(Buffer.from('image'), { actorId: 'u1' }), (error) => error.code === 'INTERNAL');

  const rejected = createWechatModeration({ openapi: { security: { imgSecCheck: async () => ({ errCode: 0, result: { suggest: 'review' } }) } } }, { enabled: true, production: true });
  await assert.rejects(() => rejected.checkImage(Buffer.from('image'), { actorId: 'u1' }), (error) => error.code === 'CONTENT_REJECTED');
});

test('头像签发、确认、资料更新保留与恢复默认形成独立闭环', async () => {
  const { call } = harness();
  const prepared = await call('profile.avatar.prepare');
  assert.equal(prepared.ok, true);
  assert.match(prepared.data.upload.cloudPath, /^private-profile-avatar-temp\//);
  const confirmed = await call('profile.avatar.confirm', { uploadId: prepared.data.upload.id, fileID: '/tmp/avatar.jpg' });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.data.user.profile.avatar.fileID, '/tmp/avatar.jpg');
  assert.equal(confirmed.data.user.profile.avatar.mockOnly, true);

  const updated = await call('profile.update', { ...PROFILE, nickname: '新昵称' });
  assert.equal(updated.data.user.profile.nickname, '新昵称');
  assert.equal(updated.data.user.profile.avatar.fileID, '/tmp/avatar.jpg');

  const cleared = await call('profile.avatar.clear');
  assert.equal(cleared.data.user.profile.avatar, null);
});

test('头像确认凭据严格绑定签发用户与文件路径', async () => {
  const { store, call } = harness();
  store.users.set('u2', { id: 'u2', role: 'user', status: 'ACTIVE', profile: { ...PROFILE, nickname: '另一位用户' } });
  const prepared = await call('profile.avatar.prepare');
  const foreignService = createPinbaService({
    store,
    moderation: createLocalModeration(),
    idGenerator: () => 'foreign_avatar',
    clock: () => new Date('2026-09-05T12:00:00.000Z')
  });
  const foreign = await foreignService.execute({
    action: 'profile.avatar.confirm',
    data: { uploadId: prepared.data.upload.id, fileID: '/tmp/avatar.jpg' },
    idempotencyKey: 'foreign_confirm_key'
  }, { actorId: 'u2' });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.error.code, 'PROFILE_AVATAR_INVALID');

  const mismatched = await call('profile.avatar.confirm', { uploadId: prepared.data.upload.id, fileID: 'https://example.com/avatar.jpg' });
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.error.code, 'PROFILE_AVATAR_INVALID');
  assert.equal(store.profileAvatarUploads.get(prepared.data.upload.id).status, 'REJECTED');
});

test('本人DTO可返回头像但页面只在个人资料与我的页消费', () => {
  const dto = selfUser({ role: 'user', status: 'ACTIVE', profile: { ...PROFILE, avatar: { status: 'ACTIVE', fileID: 'cloud://env/private/avatar.jpg', revision: 2, updatedAt: '2026-09-05T12:00:00.000Z' } } });
  assert.equal(dto.profile.avatar.fileID, 'cloud://env/private/avatar.jpg');
  const consumers = ['miniprogram/pages/user/index.js', 'miniprogram/subpackages/profile/edit/index.js'];
  consumers.forEach((file) => assert.match(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), /resolveProfileAvatar/));
  ['miniprogram/pages/discover/index.js', 'miniprogram/pages/community/index.js'].forEach((file) => assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), /profile\.avatar|avatar\.fileID/));
});

test('个人资料头像行只记录草稿并在保存资料时提交', () => {
  const root = path.join(__dirname, '../miniprogram/subpackages/profile/edit');
  const wxml = fs.readFileSync(path.join(root, 'index.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  assert.match(wxml, /open-type="chooseAvatar"[^>]*bindchooseavatar="handleChooseAvatar"/);
  assert.match(wxml, /avatarUploading/);
  assert.match(wxml, /binderror="handleAvatarImageError"/);
  assert.match(wxml, /handleRestoreAvatar/);
  const chooseHandler = js.match(/handleChooseAvatar\(event\) \{([\s\S]*?)\n  \},\n\n  handleAvatarImageError/)[1];
  const restoreHandler = js.match(/handleRestoreAvatar\(\) \{([\s\S]*?)\n  \},\n\n  handleSelectCover/)[1];
  assert.doesNotMatch(chooseHandler, /userService\./);
  assert.doesNotMatch(restoreHandler, /userService\./);
  assert.match(chooseHandler, /avatarDraftAction: 'UPLOAD'/);
  assert.match(restoreHandler, /avatarDraftAction: this\._savedAvatarHasCustom \? 'CLEAR' : ''/);
  assert.match(js, /handleSave\(\)[\s\S]*userService\.uploadAvatar\(avatarDraftPath\)/);
  assert.match(js, /handleSave\(\)[\s\S]*userService\.clearAvatar\(\)/);
});

test('选择头像后返回不写入，点击保存才依次保存资料和头像', async () => {
  const userService = require('../miniprogram/services/user');
  const original = { updateProfile: userService.updateProfile, uploadAvatar: userService.uploadAvatar, clearAvatar: userService.clearAvatar };
  const previous = { Page: global.Page, wx: global.wx, getApp: global.getApp, getCurrentPages: global.getCurrentPages, setTimeout: global.setTimeout };
  const calls = [];
  let definition;
  userService.updateProfile = async (profile) => { calls.push(['profile', profile]); return { user: { profile } }; };
  userService.uploadAvatar = async (filePath) => { calls.push(['avatar', filePath]); return { user: { profile: { ...PROFILE, avatar: { fileID: 'cloud://env/avatar.jpg' } } } }; };
  userService.clearAvatar = async () => { calls.push(['clear']); return { user: { profile: PROFILE } }; };
  global.Page = (value) => { definition = value; };
  global.wx = { showToast() {}, navigateBack() {}, redirectTo() {}, switchTab() {}, hideKeyboard() {} };
  global.getApp = () => ({ globalData: {} });
  global.getCurrentPages = () => [{}, {}];
  global.setTimeout = (callback) => { callback(); return 1; };
  delete require.cache[EDIT_PAGE_PATH];
  require(EDIT_PAGE_PATH);
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch, callback) { applyPagePatch(this.data, patch); if (callback) callback(); }
  };
  page.data.loading = false;
  page.data.form = { ...PROFILE, birthDate: '2000-01-01', interestsText: '', adultConfirmed: true };
  try {
    page.handleChooseAvatar({ detail: { avatarUrl: 'wxfile://tmp/new-avatar.jpg' } });
    assert.deepEqual(calls, []);
    assert.equal(page.data.avatarDraftAction, 'UPLOAD');
    assert.equal(page.data.profileAvatarPath, 'wxfile://tmp/new-avatar.jpg');

    await page.handleSave();
    assert.deepEqual(calls.map(([kind]) => kind), ['profile', 'avatar']);
    assert.equal(calls[1][1], 'wxfile://tmp/new-avatar.jpg');
  } finally {
    Object.assign(userService, original);
    delete require.cache[EDIT_PAGE_PATH];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  }
});

test('文字资料已保存但头像失败时保留草稿并给出准确重试提示', async () => {
  const script = fs.readFileSync(path.join(__dirname, '../miniprogram/subpackages/profile/edit/index.js'), 'utf8');
  assert.match(script, /let profileSaved = false;[\s\S]*profileSaved = true;/);
  assert.match(script, /profileSaved && this\.data\.avatarDraftAction[\s\S]*文字资料已保存，头像保存失败，请再次点击保存重试/);
  assert.match(script, /catch \(error\) \{\s*if \(this\._disposed\) return;/);
});
