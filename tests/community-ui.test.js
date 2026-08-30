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

test('社区首页采用紧凑标题、嵌入发帖入口和三行正文预览', () => {
  const template = read('pages/community/index.wxml');
  const style = read('pages/community/index.wxss');
  assert.match(template, /校园社区/);
  assert.match(template, /\+ 发起讨论/);
  assert.doesNotMatch(template, /class="[^"]*fab/);
  assert.match(style, /-webkit-line-clamp:\s*3/);
  assert.match(style, /padding-bottom:\s*calc\([^;]*safe-area-inset-bottom/);
});

test('社区详情回复栏具备键盘与安全区避让，装饰头像退出无障碍树', () => {
  const template = read('subpackages/community/detail/index.wxml');
  const style = read('subpackages/community/detail/index.wxss');
  assert.match(template, /cursor-spacing="120"/);
  assert.match(template, /adjust-position="true"/);
  assert.match(template, /aria-hidden="true"/);
  assert.match(style, /env\(safe-area-inset-bottom\)/);
});
