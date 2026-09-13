'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram/subpackages/community/detail');

test('详情点赞切换不触发原生禁用态或操作区几何变化', () => {
  const template = fs.readFileSync(path.join(root, 'index.wxml'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'index.wxss'), 'utf8');

  assert.doesNotMatch(template, /disabled="\{\{(?:post|item)\.likePending\}\}"/);
  assert.match(template, /class="heart-icon"/);
  assert.match(template, /class="reply-heart"/);
  assert.match(template, /class="like-count-value"/);
  assert.match(style, /\.post-like\s*\{[^}]*flex:\s*0 0 126rpx[^}]*width:\s*126rpx/s);
  assert.match(style, /\.reply-like\s*\{[^}]*flex:\s*0 0 108rpx[^}]*width:\s*108rpx/s);
  assert.match(style, /\.heart-icon[^}]*width:\s*44rpx/s);
  assert.match(style, /\.like-count-value[^}]*min-width:\s*44rpx/s);
  assert.doesNotMatch(style, /\.like-button--pressed\s*\{[^}]*transform:/s);
  assert.match(style, /\.detail-page\s*\{[^}]*overflow-x:\s*hidden/s);
});
