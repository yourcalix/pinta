'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { decorateActivity } = require('../miniprogram/utils/display');

const root = path.resolve(__dirname, '../miniprogram');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('原生 TabBar 使用四组体素激活与未激活图标', () => {
  const app = JSON.parse(read('app.json'));
  const expected = ['discover', 'community', 'publish', 'user'];
  assert.equal(app.tabBar.list.length, expected.length);
  app.tabBar.list.forEach((item, index) => {
    assert.equal(item.iconPath, `assets/images/discover/tab-${expected[index]}-inactive.png`);
    assert.equal(item.selectedIconPath, `assets/images/discover/tab-${expected[index]}-active.png`);
  });
});

test('发现页保持首版层级并使用真实文字叠加透明 Hero 素材', () => {
  const template = read('pages/discover/index.wxml');
  const hero = template.indexOf('class="hero surface"');
  const mode = template.indexOf('class="view-mode-switch"');
  const search = template.indexOf('class="search-row surface"');
  const campus = template.indexOf('class="campus-chip-bar"');
  const heading = template.indexOf('class="list-heading"');

  assert.ok(hero >= 0);
  assert.match(template, /src="\.\.\/\.\.\/assets\/images\/discover\/hero-campus\.png"/);
  assert.match(template, /澳门校园公益合乘/);
  assert.match(template, /一起出发，让每段路都有人同行/);
  assert.ok(hero < mode && mode < search && search < campus && campus < heading);
  assert.doesNotMatch(template, /class="search-button"/);
  assert.match(template, /class="search-glyph"/);
  assert.doesNotMatch(template, />⌕</);
});

test('行程卡片将信息与体素视觉底带分层并保持整卡点击', () => {
  const template = read('components/activity-card/index.wxml');
  assert.match(template, /class="route-heading"/);
  assert.match(template, /class="card-visual-band"/);
  assert.match(template, /class="passenger-avatars"/);
  assert.match(template, /class="route-voxel-scene"/);
  assert.match(template, /ride-car-green\.png/);
  assert.match(template, /node-start-green\.png/);
  assert.match(template, /node-start-blue\.png/);
  assert.match(template, /node-end-taipa\.png/);
  assert.match(template, /node-end-golden-dragon\.png/);
  assert.match(template, /src="\{\{slot\.src\}\}"/);
  assert.doesNotMatch(template, />查看详情</);
  assert.match(template, /bindtap="handleTap"/);
});

test('拼车展示模型提供路线代号、时间窗、节点与非身份化头像槽位', () => {
  const activity = decorateActivity({
    id: 'ride-1',
    type: 'ride',
    title: '青茂口岸到凼仔校区',
    district: '澳门校园',
    placeLabel: '青茂口岸 → 凼仔校区',
    startsAt: '2026-08-24T10:00:00.000Z',
    deadlineAt: '2026-08-24T09:00:00.000Z',
    targetMembers: 2,
    minPassengers: 2,
    maxPassengers: 4,
    memberCount: 2,
    status: 'FORMED',
    viewerRole: 'guest',
    rideFulfillment: { status: 'UNASSIGNED' },
    avatarSlots: [
      { kind: 'PASSENGER_A' },
      { kind: 'PASSENGER_B' },
      { kind: 'EMPTY' }
    ],
    typeData: {
      routeId: 'QINGMAO_TO_TAIPA',
      routeCode: '青城',
      origin: { id: 'QINGMAO', label: '青茂口岸' },
      destination: { id: 'TAIPA_CAMPUS', label: '凼仔校区' },
      pickupWindowEnd: '2026-08-24T11:00:00.000Z'
    }
  });

  assert.equal(activity.routeCode, '青城');
  assert.equal(activity.originLocationId, 'QINGMAO');
  assert.equal(activity.destinationLocationId, 'TAIPA_CAMPUS');
  assert.match(activity.timeWindowLabel, /\d{2}:\d{2}–\d{2}:\d{2}/);
  assert.deepEqual(activity.avatarSlots.map((slot) => slot.kind), [
    'PASSENGER_A', 'PASSENGER_B', 'EMPTY', 'EMPTY', 'EMPTY', 'EMPTY', 'EMPTY'
  ]);
});
