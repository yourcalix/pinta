'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('底部导航按发现、社区、发布、我的排列', () => {
  const app = JSON.parse(read('app.json'));
  assert.deepEqual(app.tabBar.list.map((item) => item.text), ['发现', '社区', '发布', '我的']);
  assert.equal(app.tabBar.list[1].pagePath, 'pages/community/index');
});

test('社区首页采用体素品牌头部、低权重发帖入口和三行正文预览', () => {
  const template = read('pages/community/index.wxml');
  const style = read('pages/community/index.wxss');
  assert.match(template, /校园社区/);
  assert.match(template, /\+ 发起讨论/);
  assert.match(template, /tab-community-active\.png/);
  assert.match(template, /class="header-voxel"[\s\S]*aria-hidden="true"/);
  assert.match(template, /class="community-watermark"[\s\S]*aria-hidden="true"/);
  assert.doesNotMatch(template, /class="[^"]*fab/);
  assert.match(style, /\.compose-button\s*\{[\s\S]*background:\s*#e8f5ee[\s\S]*color:\s*#11784f/);
  assert.match(style, /-webkit-line-clamp:\s*3/);
  assert.match(style, /padding-bottom:\s*calc\([^;]*safe-area-inset-bottom/);
});

test('社区空状态和帖子卡片复用体素素材并保持轻量绿色层级', () => {
  const template = read('pages/community/index.wxml');
  const style = read('pages/community/index.wxss');
  assert.doesNotMatch(template, /class="empty-symbol"/);
  assert.match(template, /class="empty-voxel-icon"[\s\S]*tab-community-active\.png/);
  assert.match(template, /class="section-status-dot"/);
  assert.match(template, /class="post-accent"/);
  assert.match(style, /\.empty-voxel-icon\s*\{[\s\S]*width:\s*120rpx/);
  assert.match(style, /\.post-accent\s*\{[\s\S]*top:\s*50%[\s\S]*translateY\(-50%\)/);
  assert.match(style, /\.community-watermark\s*\{[\s\S]*opacity:\s*0\.0(?:2|25|3)/);
});

test('社区详情回复栏具备键盘与安全区避让，装饰头像退出无障碍树', () => {
  const template = read('subpackages/community/detail/index.wxml');
  const style = read('subpackages/community/detail/index.wxss');
  assert.match(template, /cursor-spacing="120"/);
  assert.match(template, /adjust-position="true"/);
  assert.match(template, /aria-hidden="true"/);
  assert.match(style, /env\(safe-area-inset-bottom\)/);
});
