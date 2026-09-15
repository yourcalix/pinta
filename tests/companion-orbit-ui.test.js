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

test('在线星球使用原生Canvas低速自转并完整清理动画与只读轮询', () => {
  const script = read('subpackages/community/companion/index.js');
  const template = read('subpackages/community/companion/index.wxml');
  const style = read('subpackages/community/companion/index.wxss');
  const runtime = read('subpackages/community/companion/directory-runtime.js');
  const config = JSON.parse(read('subpackages/community/companion/index.json'));
  assert.equal(config.navigationStyle, 'custom');
  assert.equal(config.disableScroll, true);
  assert.match(template, /type="2d"/);
  assert.match(template, /aria-hidden="true"/);
  assert.match(template, /bindtouchstart="handleCanvasTouchStart"/);
  assert.match(template, /bindtouchmove="handleCanvasTouchMove"/);
  assert.match(template, /bindtouchend="handleCanvasTouchEnd"/);
  assert.match(template, /bindtouchcancel="handleCanvasTouchCancel"/);
  assert.match(style, /pointer-events:\s*auto/);
  assert.match(style, /#0d0c1b/i);
  assert.match(script, /Math\.min\([^\n]*pixelRatio[^\n]*2\.5/);
  assert.match(script, /requestAnimationFrame/);
  assert.match(script, /cancelAnimationFrame/);
  assert.match(script, /directoryService\.snapshot\(this\._directoryEtag\)/);
  assert.match(script, /appPresence\.ready\(\)/);
  assert.match(read('subpackages/community/companion/directory-service.js'), /companion\.directory\.snapshot/);
  assert.match(runtime, /FAST_DIRECTORY_POLL_MS\s*=\s*9_000/);
  assert.match(runtime, /STEADY_DIRECTORY_POLL_MS\s*=\s*18_000/);
  assert.match(runtime, /DIRECTORY_POLL_BACKOFF_MS\s*=\s*\[10_000,\s*20_000,\s*40_000,\s*60_000\]/);
  assert.match(script, /setTimeout/);
  assert.match(script, /clearTimeout/);
  assert.doesNotMatch(script, /directoryService\.onlineSnapshot\(\)/);
  assert.doesNotMatch(script, /setInterval/);
  assert.match(script, /onHide\(\)[\s\S]*stopRuntime/);
  assert.match(script, /onUnload\(\)[\s\S]*stopRuntime/);
  assert.match(script, /onShow\(\)[\s\S]*this\.loadDirectory\(false\)/);
  assert.match(script, /if \(this\._directoryRequestPending\)[\s\S]*this\._directoryRefreshQueued = true/);
  assert.match(script, /onHide\(\)[\s\S]*this\._directoryLoadSeq \+= 1[\s\S]*this\._directoryRequestPending = false[\s\S]*this\._directoryRefreshQueued = false/);
  assert.match(script, /seq !== this\._directoryLoadSeq/);
  assert.match(script, /snapshot\.unchanged/);
  assert.match(script, /mergeSphereNodes/);
  assert.doesNotMatch(script, /this\.data\.joined\s*=/);
  assert.doesNotMatch(script, /setData\([^)]*rotation/);
  assert.match(script, /INERTIA_FRICTION_PER_FRAME\s*=\s*\.92/);
  assert.match(script, /AUTO_RESUME_DELAY_MS\s*=\s*800/);
  assert.match(script, /visualScaleForZoom/);
});

test('搭子星球静默展示最多50位目录用户并只读呈现App在线人数', () => {
  const script = read('subpackages/community/companion/index.js');
  const template = read('subpackages/community/companion/index.wxml');
  const runtime = read('subpackages/community/companion/directory-runtime.js');
  assert.match(template, /当前.*人在线/);
  assert.match(template, /在线人数随进入或离开小程序自动更新/);
  assert.match(template, /搭子星球暂时失联了/);
  assert.doesNotMatch(template, /开始寻找搭子|点击停止|当前展示其中|星球已有/);
  assert.doesNotMatch(template, /orbit-action/);
  assert.match(runtime, /MAX_RENDERED_USERS\s*=\s*50/);
  assert.match(script, /MAX_VISIBLE_LABELS\s*=\s*18/);
  assert.doesNotMatch(script, /handleTogglePresence|startHeartbeat|leavePresence|_presenceSessionToken|joined|joining|directoryTotal/);
  assert.match(script, /frontNodes/);
  assert.doesNotMatch(script, /selfHighlightUntil|public-online-dot|在线光环/);
  assert.doesNotMatch(template, /navigator[^>]+profile|私信|位置/);
});
