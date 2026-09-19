'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('我的主页把关注与粉丝升级为保持原比例的安全入口', () => {
  const template = read('miniprogram/pages/user/index.wxml');
  const script = read('miniprogram/pages/user/index.js');
  assert.match(template, /profile-social-overview-item[^>]+data-type="FOLLOWING"[^>]+bindtap="handleSocialListTap"/);
  assert.match(template, /profile-social-overview-item[^>]+data-type="FOLLOWERS"[^>]+bindtap="handleSocialListTap"/);
  assert.match(script, /subpackages\/profile\/follows\/index\?type=/);
  assert.match(script, /_socialNavigationPending/);
});

test('关注粉丝页具备双 Tab、完整列表状态和暖米白适配', () => {
  const app = JSON.parse(read('miniprogram/app.json'));
  const profilePackage = app.subPackages.find((item) => item.root === 'subpackages/profile');
  assert.ok(profilePackage.pages.includes('follows/index'));
  const config = JSON.parse(read('miniprogram/subpackages/profile/follows/index.json'));
  const template = read('miniprogram/subpackages/profile/follows/index.wxml');
  const style = read('miniprogram/subpackages/profile/follows/index.wxss');
  const script = read('miniprogram/subpackages/profile/follows/index.js');
  assert.equal(config.enablePullDownRefresh, true);
  assert.equal(config.backgroundColor.toUpperCase(), '#F9F7F2');
  assert.match(template, /role="tablist"/);
  assert.match(template, /data-type="FOLLOWING"/);
  assert.match(template, /data-type="FOLLOWERS"/);
  assert.match(template, /empty-favorite/);
  assert.match(template, /empty-network/);
  assert.match(template, /data-index="\{\{index\}\}"/);
  assert.doesNotMatch(template, /data-(?:token|user-id|openid)|profileNavToken/);
  assert.match(style, /background(?:-color)?:\s*#f9f7f2/i);
  assert.match(style, /min-height:\s*136rpx/);
  assert.match(style, /font-variant-numeric:\s*tabular-nums/);
  assert.match(style, /pointer-events:\s*none/);
  assert.match(style, /@media\s*\(max-width:\s*340px\)/);
  assert.doesNotMatch(template, /follow-refreshing/);
  assert.doesNotMatch(style, /follow-refreshing|follow-pulse/);
  assert.doesNotMatch(script, /\brefreshing\b/);
});

test('列表凭据仅留在页面实例并经一次性内存桥打开暖色公开主页', () => {
  const script = read('miniprogram/subpackages/profile/follows/index.js');
  const publicScript = read('miniprogram/subpackages/profile/public/index.js');
  assert.match(script, /_credentialsByTab/);
  assert.match(script, /delete\s+displayItem\.profileNavToken|profileNavToken:\s*undefined/);
  assert.match(script, /ephemeralProfileNavigation\.issue/);
  assert.match(script, /profileNavExpiresAt/);
  assert.match(script, /5000/);
  assert.match(script, /\/subpackages\/profile\/public\/index\?k=/);
  assert.doesNotMatch(script, /setStorage|profileNavToken[^\n]+url/);
  assert.match(publicScript, /ticket\.source === 'social'/);
});

test('列表请求使用代际锁、分页互斥与返回静默刷新', () => {
  const script = read('miniprogram/subpackages/profile/follows/index.js');
  assert.match(script, /_requestSeq/);
  assert.match(script, /_tabData/);
  assert.match(script, /_loadingMore/);
  assert.match(script, /onPullDownRefresh/);
  assert.match(script, /onReachBottom/);
  assert.match(script, /_refreshOnShow/);
  assert.match(script, /wx\.stopPullDownRefresh/);
});
