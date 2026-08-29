'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('发布拼车采用体素风格单页长表单且不再暴露分步控件', () => {
  const template = read('subpackages/publish/form/index.wxml');
  const style = read('subpackages/publish/form/index.wxss');
  const script = read('subpackages/publish/form/index.js');

  assert.doesNotMatch(template, /step-count|progress-track|下一步|上一步/);
  assert.doesNotMatch(script, /handleNext\(|handleBack\(|step:\s*1/);
  assert.doesNotMatch(template, /<scroll-view/);
  assert.match(template, /class="publish-hero surface"/);
  assert.match(template, /brand-puzzle\.png/);
  assert.match(template, /ride-car-green\.png/);
  assert.match(template, /class="fixed-submit-bar"/);
  assert.match(style, /\.form-page\s*\{[\s\S]*padding-bottom:\s*calc\(/);
  assert.match(style, /\.fixed-submit-bar\s*\{[\s\S]*position:\s*fixed/);
});

test('路线双框由同一个固定路线 multiSelector 驱动并按选择展示体素预览', () => {
  const template = read('subpackages/publish/form/index.wxml');
  const script = read('subpackages/publish/form/index.js');

  assert.match(template, /mode="multiSelector"[\s\S]*class="route-picker-grid"/);
  assert.match(template, /routeOriginLabel/);
  assert.match(template, /routeDestinationLabel/);
  assert.match(template, /wx:if="\{\{routeSelected\}\}"[\s\S]*route-visual/);
  assert.match(script, /routeSelected:\s*false/);
  assert.match(script, /routeOriginLabel:\s*'选择起点'/);
  assert.match(script, /routeDestinationLabel:\s*'选择终点'/);
  assert.match(script, /rideRouteFromIndexes/);
});

test('发布页容量为当前发起者头像加六个空位且装饰图退出无障碍树', () => {
  const template = read('subpackages/publish/form/index.wxml');
  const script = read('subpackages/publish/form/index.js');

  assert.match(script, /profileAvatarPath/);
  assert.match(script, /createPublisherSlots/);
  assert.match(script, /Array\.from\(\{ length: 7 \}/);
  assert.match(template, /wx:for="\{\{publisherSlots\}\}"/);
  assert.match(template, /aria-label="行程容量，最多七名乘客，当前包含发起者一人"/);
  assert.match(template, /class="capacity-avatar[^\"]*"[\s\S]*aria-hidden="true"/);
});

test('发布适配器自动生成路线标题并把隐藏截止设为出发前一秒', () => {
  const script = read('subpackages/publish/form/index.js');

  assert.match(script, /function buildRideTitle\(/);
  assert.match(script, /function rideDeadlineAt\(/);
  assert.match(script, /startsAtMs\s*-\s*1000/);
  assert.match(script, /title:\s*buildRideTitle\(/);
  assert.match(script, /deadlineAt:\s*rideDeadlineAt\(/);
  assert.match(script, /function safeRideStartsAt\([\s\S]*try\s*\{[\s\S]*catch \(error\)/);
  assert.match(script, /MIN_SCHEDULE_LEAD_MS\s*=\s*5 \* 60 \* 1000/);
  assert.match(script, /const now = Date\.now\(\)/);
  assert.doesNotMatch(read('subpackages/publish/form/index.wxml'), /行程标题|截止日期|截止时间/);
});

test('行李电话协议共同控制发布按钮且电话只停留在当前页面内存', () => {
  const template = read('subpackages/publish/form/index.wxml');
  const script = read('subpackages/publish/form/index.js');

  assert.match(template, /class="luggage-chip[\s\S]*role="radio"/);
  assert.match(template, /disabled="\{\{submitting \|\| !submitReady\}\}"/);
  assert.match(template, /class="agreement[\s\S]*aria-invalid/);
  assert.match(script, /submitReady:\s*false/);
  assert.match(script, /onHide\(\)[\s\S]*phoneNumber/);
  assert.match(script, /const \{ phoneNumber, \.\.\.safeForm \}/);
  assert.match(script, /errorField/);
});
