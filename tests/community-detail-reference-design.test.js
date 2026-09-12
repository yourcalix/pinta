'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function loadDetailModule() {
  const previousPage = global.Page;
  global.Page = () => {};
  try {
    return require('../miniprogram/subpackages/community/detail/index');
  } finally {
    if (previousPage === undefined) delete global.Page;
    else global.Page = previousPage;
  }
}

test('讨论详情使用暖米白自定义导航与白色圆角内容卡', () => {
  const config = JSON.parse(read('subpackages/community/detail/index.json'));
  const template = read('subpackages/community/detail/index.wxml');
  const style = read('subpackages/community/detail/index.wxss');

  assert.equal(config.navigationStyle, 'custom');
  assert.equal(config.navigationBarTextStyle, 'black');
  assert.equal(config.backgroundColor, '#F9F7F2');
  assert.match(template, /detail-navigation/);
  assert.match(template, /contentTopInset/);
  assert.doesNotMatch(template, /shared-paper-bg|global-page-background/);
  assert.match(style, /#f9f7f2/i);
  assert.match(style, /border-radius:\s*32rpx/);
});

test('讨论详情保留真实交互并以文字分段高亮话题', () => {
  const template = read('subpackages/community/detail/index.wxml');
  const script = loadDetailModule();

  assert.match(template, /post\.contentSegments/);
  assert.match(template, /topic-pill/);
  assert.match(template, /class="empty-replies surface"[^>]*role="status"/);
  assert.match(template, /data-target-type="post"/);
  assert.match(template, /data-target-type="reply"/);
  assert.match(template, /handlePostMore/);
  assert.match(template, /handleReplyMore/);
  assert.match(template, /placeholder="写下你的回复…"/);
  assert.doesNotMatch(template, /图片|image-picker|chooseMedia/);

  assert.deepEqual(script.splitContentSegments('一起去吧 #寻找搭子 ☀️'), [
    { type: 'text', text: '一起去吧 ' },
    { type: 'tag', text: '#寻找搭子' },
    { type: 'text', text: ' ☀️' }
  ]);
});

test('讨论详情时间使用克制的相对时间并对旧时间回退日期', () => {
  const { formatCommunityTime } = loadDetailModule();
  const now = Date.parse('2026-09-13T04:00:00.000Z');
  assert.equal(formatCommunityTime('2026-09-13T03:55:20.000Z', now), '4分钟前');
  assert.equal(formatCommunityTime('2026-09-13T01:00:00.000Z', now), '3小时前');
  assert.equal(formatCommunityTime('2026-09-11T04:00:00.000Z', now), '2天前');
  assert.equal(formatCommunityTime('2026-08-01T04:00:00.000Z', now), '8月1日');
});

test('底部回复栏保留键盘、安全区和小屏弹性', () => {
  const template = read('subpackages/community/detail/index.wxml');
  const style = read('subpackages/community/detail/index.wxss');
  assert.match(template, /cursor-spacing="120"/);
  assert.match(template, /adjust-position="true"/);
  assert.match(style, /env\(safe-area-inset-bottom\)/);
  assert.match(style, /@media\s*\(max-width:\s*340px\)/);
  assert.match(style, /\.post-action-button\s*\{[^}]*min-height:\s*88rpx/s);
  assert.match(style, /\.reply-like\s*\{[^}]*min-height:\s*88rpx/s);
  assert.match(style, /\.reply-author-line\s*\{[^}]*flex:\s*1;[^}]*min-width:\s*0;/s);
  assert.match(style, /\.reply-operations\s*\{[^}]*inline-flex[^}]*flex:\s*0 0 auto/s);
  assert.match(style, /\.topic-pill\s*\{[^}]*display:\s*inline-flex[^}]*vertical-align:\s*middle/s);
});
