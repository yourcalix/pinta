'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('寻找搭子主题卡进入独立在线星球而非活动列表', () => {
  const app = JSON.parse(read('app.json'));
  const communityPackage = app.subPackages.find((item) => item.root === 'subpackages/community');
  assert.ok(communityPackage.pages.includes('companion/index'));
  const script = read('pages/community/index.js');
  const template = read('pages/community/index.wxml');
  assert.match(script, /subpackages\/community\/companion\/index/);
  assert.match(template, /data-action="companion"/);
  assert.match(template, /在线搭子星球/);
});

test('在线星球使用原生Canvas低速自转并完整清理动画与心跳', () => {
  const script = read('subpackages/community/companion/index.js');
  const template = read('subpackages/community/companion/index.wxml');
  const style = read('subpackages/community/companion/index.wxss');
  const config = JSON.parse(read('subpackages/community/companion/index.json'));
  assert.equal(config.navigationStyle, 'custom');
  assert.equal(config.disableScroll, true);
  assert.match(template, /type="2d"/);
  assert.match(template, /aria-hidden="true"/);
  assert.doesNotMatch(template, /bindtouch(?:start|move|end)/);
  assert.match(style, /pointer-events:\s*auto/);
  assert.match(style, /#0d0c1b/i);
  assert.match(script, /Math\.min\([^\n]*pixelRatio[^\n]*2\.5/);
  assert.match(script, /requestAnimationFrame/);
  assert.match(script, /cancelAnimationFrame/);
  assert.match(script, /HEARTBEAT_INTERVAL_MS\s*=\s*30_000/);
  assert.match(script, /this\._presenceSessionToken\s*=\s*result\.sessionToken/);
  assert.match(script, /presenceService\.leave\(sessionToken\)/);
  assert.match(script, /onHide\(\)[\s\S]*stopRuntime/);
  assert.match(script, /onUnload\(\)[\s\S]*stopRuntime/);
  assert.match(script, /onShow\(\)[\s\S]*this\.loadSnapshot\(false\)/);
  assert.doesNotMatch(script, /this\.data\.joined\s*=/);
  assert.doesNotMatch(script, /setData\([^)]*rotation/);
});

test('在线星球具备真实状态、主动加入披露与昵称景深剔除', () => {
  const script = read('subpackages/community/companion/index.js');
  const template = read('subpackages/community/companion/index.wxml');
  assert.match(template, /当前.*人正在找搭子/);
  assert.match(template, /加入后，昵称和公开资料可从星球短暂查看/);
  assert.match(template, /此刻还没有搭子加入星球/);
  assert.match(template, /搭子星球暂时失联了/);
  assert.match(template, /加入搭子星球|成为第一个在线搭子/);
  assert.match(script, /MAX_RENDERED_USERS\s*=\s*50/);
  assert.match(script, /MAX_VISIBLE_LABELS\s*=\s*18/);
  assert.match(script, /viewerIsSelf/);
  assert.match(script, /frontNodes/);
  assert.doesNotMatch(template, /navigator[^>]+profile|私信|位置/);
});
