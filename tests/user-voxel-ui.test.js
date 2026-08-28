'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../miniprogram');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('我的页面复用现有体素头像、品牌拼图和活动卡片', () => {
  const config = JSON.parse(read('pages/user/index.json'));
  const template = read('pages/user/index.wxml');
  const script = read('pages/user/index.js');

  assert.equal(config.usingComponents['activity-card'], '/components/activity-card/index');
  assert.match(template, /avatar-passenger-a\.png|profileAvatarPath/);
  assert.match(template, /brand-puzzle\.png/);
  assert.match(template, /<activity-card[\s\S]*?bindselect="handleActivitySelect"/);
  assert.match(script, /profileAvatarPath/);
  assert.match(script, /handleActivitySelect/);
  assert.doesNotMatch(template, /driver-onboarding-mark/);
});

test('我的页面只展示真实统计并在存在待办时渲染通知区', () => {
  const template = read('pages/user/index.wxml');

  assert.match(template, /class="profile-metrics surface"/);
  assert.match(template, /tasks\.length/);
  assert.match(template, /owned\.length/);
  assert.match(template, /joined\.length/);
  assert.match(template, /wx:if="\{\{tasks\.length\}\}" class="pending-section"/);
  assert.doesNotMatch(template, /减碳|同行友友|zero-task/);
});

test('一级视图切换与二级列表切换使用不同视觉层级并适配窄屏', () => {
  const template = read('pages/user/index.wxml');
  const style = read('pages/user/index.wxss');

  assert.match(template, /class="dashboard-tabs"/);
  assert.match(template, /class="list-tabs"/);
  assert.match(style, /\.dashboard-tabs[\s\S]*?min-height:\s*88rpx/);
  assert.match(style, /\.list-tab--active[\s\S]*?::after/);
  assert.match(style, /@media \(max-width:\s*340px\)[\s\S]*?\.card-visual-shell/);
});

test('我的页面审查修正确保司机空状态体素化并避免二级统计重复', () => {
  const template = read('pages/user/index.wxml');
  const style = read('pages/user/index.wxss');
  const cardStyle = read('components/activity-card/index.wxss');

  assert.match(template, /class="driver-empty"[\s\S]*?ride-car-green\.png/);
  assert.match(template, />我的发布<\/button>/);
  assert.match(template, />我的参与<\/button>/);
  assert.doesNotMatch(template, />我的发布 \{\{owned\.length\}\}<\/button>/);
  assert.doesNotMatch(template, />我的参与 \{\{joined\.length\}\}<\/button>/);
  assert.match(style, /\.driver-empty-car[\s\S]*?opacity:\s*0\.48/);
  assert.match(cardStyle, /\.card-visual-band[\s\S]*?flex-wrap:\s*wrap/);
});

test('我的页面继续使用原生规范 TabBar 素材', () => {
  const app = JSON.parse(read('app.json'));
  const userTab = app.tabBar.list.find((item) => item.pagePath === 'pages/user/index');
  const discoverTab = app.tabBar.list.find((item) => item.pagePath === 'pages/discover/index');
  const publishTab = app.tabBar.list.find((item) => item.pagePath === 'pages/publish/index');

  assert.equal(userTab.selectedIconPath, 'assets/images/discover/tab-user-active.png');
  assert.equal(discoverTab.iconPath, 'assets/images/discover/tab-discover-inactive.png');
  assert.equal(publishTab.iconPath, 'assets/images/discover/tab-publish-inactive.png');
});
