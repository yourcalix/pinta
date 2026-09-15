'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram/subpackages/community/detail');

test('详情点赞切换不触发原生禁用态或操作区几何变化', () => {
  const template = fs.readFileSync(path.join(root, 'index.wxml'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'index.wxss'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

  assert.doesNotMatch(template, /disabled="\{\{(?:post|item)\.likePending\}\}"/);
  assert.doesNotMatch(template, /like-button--pending/);
  assert.match(template, /class="heart-icon"/);
  assert.match(template, /class="reply-heart"/);
  assert.match(template, /class="like-count-value"/);
  assert.match(style, /\.post-like\s*\{[^}]*flex:\s*0 0 110rpx[^}]*width:\s*110rpx[^}]*gap:\s*6rpx/s);
  assert.match(style, /\.reply-like\s*\{[^}]*flex:\s*0 0 96rpx[^}]*width:\s*96rpx[^}]*gap:\s*6rpx/s);
  assert.match(style, /\.heart-icon[^}]*flex:\s*0 0 36rpx[^}]*width:\s*36rpx[^}]*height:\s*36rpx[^}]*font-size:\s*31rpx[^}]*line-height:\s*1[^}]*transition:\s*color 120ms ease,\s*transform 120ms ease/s);
  assert.match(style, /\.reply-heart[^}]*flex:\s*0 0 36rpx[^}]*width:\s*36rpx[^}]*height:\s*36rpx[^}]*font-size:\s*31rpx[^}]*line-height:\s*1[^}]*transition:\s*color 120ms ease,\s*transform 120ms ease/s);
  assert.doesNotMatch(style.match(/\.heart-icon\s*\{[^}]*\}/s)[0], /font-family/);
  assert.doesNotMatch(style.match(/\.reply-heart\s*\{[^}]*\}/s)[0], /font-family/);
  assert.match(style, /\.like-count-value[^}]*flex:\s*0 0 44rpx[^}]*width:\s*44rpx[^}]*color:\s*#797774/s);
  assert.match(style, /\.like-button--active \.heart-icon,\s*\.like-button--active \.reply-heart\s*\{[^}]*color:\s*#e2554f[^}]*transform:\s*scale\(1\.1\)/s);
  assert.match(style, /\.like-button--pressed \.heart-icon,\s*\.like-button--pressed \.reply-heart\s*\{[^}]*transform:\s*scale\(\.9\)/s);
  assert.doesNotMatch(style, /\.like-button--pending/);
  assert.doesNotMatch(style, /\.like-button--pressed\s*\{[^}]*(?:background|opacity):/s);
  assert.doesNotMatch(style, /\.like-button--pressed\s*\{[^}]*transform:/s);
  assert.match(style, /\.detail-page\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.doesNotMatch(script, /vibrateShort/);
  assert.match(script, /payload\[\`\$\{prefix\}\.\$\{field\}\`\]/);
  assert.match(script, /findIndex\(\(item\) => item\.id === targetId\)/);
});
