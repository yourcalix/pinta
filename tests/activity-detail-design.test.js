'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const filename = require.resolve('../miniprogram/subpackages/activity/detail/index');
function harness(activity, pages = 1, overrides = {}) {
  let definition;
  const events = [];
  const nativeRequire = createRequire(filename);
  const api = { detail: async () => ({ activity }), apply: async () => {}, ...overrides };
  const wx = { showShareMenu() {}, switchTab: v => events.push(v.url), navigateBack: () => events.push('back'), showToast() {}, ...overrides.wx };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { Page: v => { definition = v; }, wx, getCurrentPages: () => Array(pages).fill({}), require: name => name.endsWith('services/activity') ? api : name.endsWith('services/user') ? { login: overrides.login || (async () => ({ profile: { adultConfirmed: true, gender: 'MALE' } })) } : nativeRequire(name) });
  const page = { ...definition, data: structuredClone(definition.data), setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); } };
  page.onLoad({ id: 'a' });
  return { page, events };
}
const base = { id: 'a', type: 'sport', title: '活动', status: 'RECRUITING', viewerRole: 'guest', minMembers: 2, maxMembers: 20, memberCount: 2 };
test('详情冷启动返回发现、多页栈返回上页', () => {
  const cold = harness(base); cold.page.handleBack(); assert.deepEqual(cold.events, ['/pages/discover/index']);
  const warm = harness(base, 2); warm.page.handleBack(); assert.deepEqual(warm.events, ['back']);
});
test('详情操作遵循角色和终态，不生成免费/认证信息', async () => {
  for (const [changes, action] of [[{}, 'apply'], [{ viewerRole: 'owner' }, 'manage'], [{ viewerRole: 'member', status: 'FORMED' }, 'group'], [{ viewerRole: 'applicant', viewerApplication: { status: 'PENDING' } }, ''], [{ status: 'CANCELLED' }, ''], [{ legacy: { readOnly: true } }, '']]) {
    const { page } = harness({ ...base, ...changes }); await page.onShow();
    assert.equal(page.data.primaryAction, action);
    assert.doesNotMatch(page.data.primaryLabel, /免费|待审人数/);
  }
});
test('详情最多六个独立头像加隐藏实人数量，旧数据不伪造', async () => {
  const { page } = harness({ ...base, avatarSlots: Array.from({ length: 12 }, () => ({ kind: 'PASSENGER_A' })) });
  await page.onShow(); assert.equal(page.data.detailSlots.length, 6); assert.equal(page.data.hiddenMembers, 6);
  const old = harness(base); await old.page.onShow(); assert.equal(old.page.data.hiddenMembers, 0); assert.ok(old.page.data.detailSlots.every(s => s.empty));
});
test('鉴权双击合并且页面卸载后不打开抽屉', async () => {
  let release, calls = 0;
  const { page } = harness(base, 1, { login: () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  await page.onShow(); const first = page.handleApplyOpen(); const second = page.handleApplyOpen();
  page.onUnload(); release({ profile: { adultConfirmed: true, gender: 'MALE' } }); await Promise.all([first, second]);
  assert.equal(calls, 1); assert.equal(page.data.showApply, false);
});
test('详情布局采用大幅封面、白色连续面板、四段底栏并保留键盘与触控安全', () => {
  const template = fs.readFileSync(filename.replace('.js', '.wxml'), 'utf8');
  const style = fs.readFileSync(filename.replace('.js', '.wxss'), 'utf8');
  const config = JSON.parse(fs.readFileSync(filename.replace('.js', '.json')));
  assert.equal(config.navigationStyle, 'custom');
  assert.match(template, /open-type="share"/); assert.match(template, /catchtouchmove="preventScroll"/);
  assert.match(template, /class="hero-art"[^>]*mode="aspectFit"/); assert.match(template, />群聊</); assert.match(template, />聊下</);
  assert.match(template, /加入成团/); assert.match(template, /审核通过才会加入成团/);
  assert.match(template, /cursor-spacing="40"/); assert.match(template, /maxlength="120"/);
  assert.match(style, /height:\s*calc\(75vh \+ 48rpx\)/); assert.match(style, /background:\s*#fff/);
  assert.match(style, /\.footer-tool\s*\{[^}]*min-width:\s*88rpx[^}]*min-height:\s*88rpx/);
  assert.match(style, /\.primary-label\s*\{[^}]*white-space:\s*nowrap[^}]*text-overflow:\s*ellipsis/);
  assert.match(style, /background:\s*#181818/); assert.match(style, /color:\s*#2cff9a/);
  assert.match(style, /min-height:\s*44px/); assert.match(style, /safe-area-inset-bottom/);
});
