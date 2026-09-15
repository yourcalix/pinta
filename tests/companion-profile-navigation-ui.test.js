'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveCanvasTap, selectHitNode } = require('../miniprogram/subpackages/community/companion/hit-test');
const bridge = require('../miniprogram/services/ephemeral-profile-navigation');

const root = path.join(__dirname, '../miniprogram');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Canvas点击坐标使用CSS像素并保留左侧返回安全区', () => {
  const rect = { left: 18, top: 120, width: 320, height: 320 };
  assert.deepEqual(resolveCanvasTap({ changedTouches: [{ clientX: 118, clientY: 220 }] }, rect), { x: 100, y: 100, clientX: 118 });
  assert.equal(resolveCanvasTap({ changedTouches: [{ clientX: 24, clientY: 220 }] }, rect), null);
  assert.deepEqual(resolveCanvasTap({ detail: { x: 218, y: 320 } }, rect), { x: 200, y: 200, clientX: 218 });
});

test('命中测试支持昵称包围盒并以前景深度优先', () => {
  const nodes = [
    { displayToken: 'back', depth: .2, screenX: 100, screenY: 100, hitRadius: 22 },
    { displayToken: 'front', depth: .8, screenX: 112, screenY: 100, hitRadius: 22, textBounds: { left: 130, right: 210, top: 82, bottom: 112 } }
  ];
  assert.equal(selectHitNode({ x: 106, y: 100 }, nodes).displayToken, 'front');
  assert.equal(selectHitNode({ x: 170, y: 96 }, nodes).displayToken, 'front');
  assert.equal(selectHitNode({ x: 260, y: 260 }, nodes), null);
  assert.equal(selectHitNode({ x: 100, y: 100 }, [{ ...nodes[0], depth: 0 }]), null);
});

test('公开主页凭据仅在内存中一次消费并按期失效', () => {
  bridge.clear();
  const key = bridge.issue({ profileNavToken: 'companionProfileNa_test', profileNavExpiresAt: '2099-01-01T00:00:00.000Z' }, 1000, 100);
  assert.equal(bridge.consume(key, 500).profileNavToken, 'companionProfileNa_test');
  assert.equal(bridge.consume(key, 500), null);
  const expired = bridge.issue({ profileNavToken: 'expired' }, 1000, 100);
  assert.equal(bridge.consume(expired, 1201), null);
});

test('星球节点可点击且公开主页保持短期只读与完整失效态', () => {
  const app = JSON.parse(read('app.json'));
  const profilePackage = app.subPackages.find((item) => item.root === 'subpackages/profile');
  assert.ok(profilePackage.pages.includes('public/index'));

  const orbitScript = read('subpackages/community/companion/index.js');
  const orbitTemplate = read('subpackages/community/companion/index.wxml');
  const orbitStyle = read('subpackages/community/companion/index.wxss');
  assert.doesNotMatch(orbitTemplate, /bindtap="handleCanvasTap"/);
  assert.match(orbitTemplate, /bindtouchstart="handleCanvasTouchStart"/);
  assert.match(orbitTemplate, /bindtouchmove="handleCanvasTouchMove"/);
  assert.match(orbitTemplate, /bindtouchend="handleCanvasTouchEnd"/);
  assert.match(orbitTemplate, /bindtouchcancel="handleCanvasTouchCancel"/);
  assert.match(orbitTemplate, /左右滑动旋转，双指捏合缩放/);
  assert.doesNotMatch(orbitStyle, /orbit-canvas\s*\{[^}]*pointer-events:\s*none/s);
  assert.match(orbitScript, /this\._hitNodes/);
  assert.match(orbitScript, /refreshCanvasRect/);
  assert.match(orbitScript, /performCanvasHitTest/);
  assert.match(orbitScript, /ephemeralProfileNavigation\.issue/);
  assert.match(orbitScript, /directoryService\.createProfileNavigation/);
  assert.match(read('subpackages/community/companion/directory-service.js'), /companion\.directory\.profile\.nav\.create/);
  assert.match(orbitScript, /source:\s*'companion-directory'/);
  assert.doesNotMatch(orbitScript, /setStorage|profileNavToken[^\n]*url/);

  const pageScript = read('subpackages/profile/public/index.js');
  const pageTemplate = read('subpackages/profile/public/index.wxml');
  const pageConfig = JSON.parse(read('subpackages/profile/public/index.json'));
  assert.equal(pageConfig.enablePullDownRefresh, false);
  assert.match(pageScript, /ephemeralProfileNavigation\.consume/);
  assert.match(pageTemplate, /主页访问已失效/);
  assert.match(pageTemplate, /仅展示搭子主动公开的资料/);
  assert.doesNotMatch(pageTemplate, />关注<|>粉丝<|bindtap="[^"]*(?:Message|Contact|Follow)/);
});
