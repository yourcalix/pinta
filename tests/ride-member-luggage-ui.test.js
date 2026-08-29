'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('发布页以无默认值的三项 Chip 强制发起者选择自己的行李', () => {
  const script = read('subpackages/publish/form/index.js');
  const template = read('subpackages/publish/form/index.wxml');
  const style = read('subpackages/publish/form/index.wxss');
  const options = read('config/luggage.js');
  assert.match(script, /luggageType:\s*''/);
  assert.match(script, /MEMBER_LUGGAGE_OPTIONS/);
  assert.match(script, /请先选择我的行李/);
  assert.doesNotMatch(template, /行李规则/);
  assert.match(template, /我的行李/);
  assert.match(template, /data-luggage-type="\{\{item\.value\}\}"/);
  assert.match(template, /role="radiogroup"/);
  assert.match(template, /role="radio"/);
  assert.match(template, /aria-checked="\{\{form\.luggageType === item\.value\}\}"/);
  assert.match(style, /\.luggage-chip\s*\{[\s\S]*min-height:\s*88rpx/);
  assert.match(style, /\.luggage-chip\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.match(options, /value: 'NONE'/);
  assert.match(options, /value: 'SMALL'/);
  assert.match(options, /value: 'LARGE'/);
  assert.doesNotMatch(template, /data-field="luggageRule"/);
});

test('详情页加入区要求选择成员行李并将选择传给直接入团接口', () => {
  const service = read('services/activity.js');
  const script = read('subpackages/activity/detail/index.js');
  const template = read('subpackages/activity/detail/index.wxml');
  const style = read('subpackages/activity/detail/index.wxss');
  assert.match(service, /joinRide:\s*\(activityId, luggageType\)/);
  assert.match(service, /'ride\.join', \{ activityId, luggageType \}/);
  assert.match(script, /selectedLuggageType:\s*''/);
  assert.match(script, /selectedLuggageType:\s*activity\.viewerMembership\s*&&\s*activity\.viewerMembership\.luggageType\s*\|\|\s*''/);
  assert.match(script, /joinRide\(this\.data\.id, this\.data\.selectedLuggageType\)/);
  assert.match(template, /请选择您的行李/);
  assert.match(template, /role="radiogroup"/);
  assert.match(template, /role="radio"/);
  assert.match(template, /aria-checked="\{\{selectedLuggageType === item\.value\}\}"/);
  assert.match(template, /disabled="\{\{pending \|\| !selectedLuggageType\}\}"/);
  assert.match(style, /\.luggage-chip\s*\{[\s\S]*min-height:\s*88rpx/);
  assert.match(style, /\.luggage-chip\s*\{[\s\S]*white-space:\s*nowrap/);
});
