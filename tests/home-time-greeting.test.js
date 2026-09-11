'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { resolveMacauGreeting } = require('../miniprogram/utils/home-greeting');

const atMacauTime = (hour, minute = 0) => new Date(Date.UTC(2026, 8, 10, hour - 8, minute));

test('首页问候按澳门自然时段覆盖凌晨、早上、上午、中午、下午和晚上', () => {
  const cases = [
    [0, '夜深了'], [4, '夜深了'],
    [5, '早上好'], [8, '早上好'],
    [9, '上午好'], [11, '上午好'],
    [12, '中午好'], [13, '中午好'],
    [14, '下午好'], [17, '下午好'],
    [18, '晚上好'], [23, '晚上好']
  ];
  cases.forEach(([hour, expected]) => assert.equal(resolveMacauGreeting(atMacauTime(hour)), expected));
});

test('首页展示动态问候并在页面载入和每次显示时刷新', () => {
  const script = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/discover/index.js'), 'utf8');
  const template = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/discover/index.wxml'), 'utf8');
  assert.match(template, /\{\{greetingSalutation\}\}，\{\{greetingNickname\}\}/);
  assert.match(script, /syncGreetingSalutation\(\)/);
  assert.ok((script.match(/this\.syncGreetingSalutation\(\)/g) || []).length >= 2);
});
