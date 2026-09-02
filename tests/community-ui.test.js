'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('底部导航按发现、社区、发布、消息、我的排列', () => {
  const app = JSON.parse(read('app.json'));
  assert.deepEqual(app.tabBar.list.map((item) => item.text), ['发现', '社区', '发布', '消息', '我的']);
  assert.equal(app.tabBar.list[1].pagePath, 'pages/community/index');
});

test('社区首页采用深蓝纸纹、低权重整条发帖入口和三行正文预览', () => {
  const template = read('pages/community/index.wxml');
  const style = read('pages/community/index.wxss');
  assert.match(template, /拼吧 · 社区/);
  assert.match(template, /PINBA COMMUNITY/);
  assert.match(template, /最近有什么想和大家聊聊/);
  assert.match(template, /class="compose-strip"[\s\S]*aria-label="发起新讨论/);
  assert.match(template, /publish-paper-texture\.webp/);
  assert.doesNotMatch(template, /tab-community-active\.png|header-voxel|community-watermark/);
  assert.doesNotMatch(template, /class="[^"]*fab/);
  assert.match(style, /\.compose-strip\s*\{[\s\S]*min-height:\s*88rpx[\s\S]*background:\s*#fff8ee/i);
  assert.match(style, /-webkit-line-clamp:\s*3/);
  assert.match(style, /word-break:\s*break-all/);
  assert.match(style, /overflow-wrap:\s*anywhere/);
  assert.match(style, /padding-bottom:\s*calc\([^;]*safe-area-inset-bottom/);
});

test('社区空状态与帖子卡使用奶油白纸片、CSS 气泡和受控单字头像', () => {
  const template = read('pages/community/index.wxml');
  const style = read('pages/community/index.wxss');
  const script = read('pages/community/index.js');
  assert.match(template, /class="empty-bubble"[\s\S]*aria-hidden="true"/);
  assert.match(template, /class="post-avatar post-avatar--\{\{item\.avatarTone\}\}"/);
  assert.match(template, /\{\{item\.avatarInitial\}\}/);
  assert.doesNotMatch(template, /class="post-avatar"[^>]*<image|avatarPath/);
  assert.match(style, /\.post-card\s*\{[\s\S]*background:\s*#fff8ee/i);
  assert.match(style, /\.post-avatar\s*\{[\s\S]*width:\s*56rpx[\s\S]*height:\s*56rpx/);
  assert.match(script, /AVATAR_TONES/);
  assert.match(script, /avatarInitial/);
  assert.match(script, /loadMoreError/);
  assert.match(script, /讨论加载失败，请检查网络/);
});

test('社区详情回复栏具备键盘与安全区避让，装饰头像退出无障碍树', () => {
  const template = read('subpackages/community/detail/index.wxml');
  const style = read('subpackages/community/detail/index.wxss');
  assert.match(template, /cursor-spacing="120"/);
  assert.match(template, /adjust-position="true"/);
  assert.match(template, /aria-hidden="true"/);
  assert.match(style, /env\(safe-area-inset-bottom\)/);
});
