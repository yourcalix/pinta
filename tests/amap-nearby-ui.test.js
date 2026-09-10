'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');
const activityService = require('../miniprogram/services/activity');
const ORIGIN = { latitude: 22.198745, longitude: 113.543873 };

function loadNearbyPage() {
  let definition;
  let getLocationCalls = 0;
  global.Page = (value) => { definition = value; };
  global.wx = {
    getLocation(options) { getLocationCalls += 1; options.success({ latitude: 22.198745, longitude: 113.543873 }); },
    stopPullDownRefresh() {}, openSetting() {}, redirectTo() {}, navigateTo() {}
  };
  const pagePath = require.resolve('../miniprogram/subpackages/activity/nearby/index');
  delete require.cache[pagePath];
  require(pagePath);
  return {
    pagePath,
    getLocationCalls: () => getLocationCalls,
    page: { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } }
  };
}

function unloadNearbyPage(context) {
  delete require.cache[context.pagePath];
  delete global.Page;
  delete global.wx;
}

function loadLocationPickerPage() {
  let definition;
  global.Page = (value) => { definition = value; };
  global.wx = { navigateBack() {} };
  const pagePath = require.resolve('../miniprogram/subpackages/publish/location-picker/index');
  delete require.cache[pagePath];
  require(pagePath);
  return {
    pagePath,
    page: { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } }
  };
}

function unloadLocationPickerPage(context) {
  delete require.cache[context.pagePath];
  delete global.Page;
  delete global.wx;
}

test('高德 Key 仅通过运行配置注入且 POI 适配器不持久化用户位置', () => {
  const defaults = require('../miniprogram/config/index');
  const example = require('../miniprogram/config/local.example');
  const resolver = fs.readFileSync(path.join(root, 'config/runtime-resolver.js'), 'utf8');
  const amap = fs.readFileSync(path.join(root, 'services/amap.js'), 'utf8');
  assert.equal(defaults.amapMiniProgramKey, '');
  assert.equal(example.amapMiniProgramKey, 'your-amap-mini-program-key');
  assert.match(resolver, /amapMiniProgramKey/);
  assert.match(amap, /restapi\.amap\.com\/v3\/assistant\/inputtips/);
  assert.doesNotMatch(amap, /setStorage|setStorageSync/);
});

test('活动和发布分包注册附近页与 POI 选点页，并声明定位用途', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  assert.ok(app.subPackages.find((item) => item.root === 'subpackages/activity').pages.includes('nearby/index'));
  assert.ok(app.subPackages.find((item) => item.root === 'subpackages/publish').pages.includes('location-picker/index'));
  assert.match(app.permission['scope.userLocation'].desc, /距离/);
  assert.ok(app.requiredPrivateInfos.includes('getLocation'));
});

test('三类表单共用公开会合地点 POI 控件，文本修改会清除旧坐标且提交强校验', () => {
  const script = fs.readFileSync(path.join(root, 'subpackages/publish/form/index.js'), 'utf8');
  const template = fs.readFileSync(path.join(root, 'subpackages/publish/form/index.wxml'), 'utf8');
  assert.match(script, /meetingPoint/);
  assert.match(script, /请选择有效的活动会合地点/);
  assert.match(script, /handleOpenMeetingPointPicker/);
  assert.match(script, /form\.meetingPoint': null/);
  assert.equal((template.match(/公开会合地点/g) || []).length >= 3, true);
  assert.match(template, /这是活动公开地点，用于附近发现，不会保存您的实时位置/);
});

test('首页入口分工为组队拼团进全城列表、发现更多进附近页，标题不冒充附近', () => {
  const script = fs.readFileSync(path.join(root, 'pages/discover/index.js'), 'utf8');
  const template = fs.readFileSync(path.join(root, 'pages/discover/index.wxml'), 'utf8');
  assert.match(script, /action === 'activities'[\s\S]*\/subpackages\/activity\/list\/index/);
  assert.match(script, /handleNavigateToAll[\s\S]*\/subpackages\/activity\/nearby\/index/);
  assert.match(template, /正在组队/);
  assert.match(template, /全城热拼/);
  assert.doesNotMatch(template, /附近拼吧 · 正在发生/);
});

test('附近页先说明再由用户点击授权，并具备半径筛选和完整降级状态', () => {
  const script = fs.readFileSync(path.join(root, 'subpackages/activity/nearby/index.js'), 'utf8');
  const template = fs.readFileSync(path.join(root, 'subpackages/activity/nearby/index.wxml'), 'utf8');
  assert.match(script, /handleEnableLocation/);
  assert.match(script, /type:\s*'gcj02'/);
  assert.match(script, /activityService\.nearby/);
  assert.doesNotMatch(script, /setStorage|setStorageSync/);
  assert.match(template, /仅用于临时计算距离，不保存实时位置/);
  assert.match(template, /1km[\s\S]*3km[\s\S]*5km[\s\S]*10km/);
  assert.match(template, /去查看全城活动/);
  assert.match(template, /打开设置/);
});

test('附近页不会冷启动索取定位，授权坐标只留在页面实例且离屏即清除', async () => {
  const originalNearby = activityService.nearby;
  const requests = [];
  activityService.nearby = async (input) => { requests.push(input); return { items: [], nextCursor: null }; };
  const context = loadNearbyPage();
  try {
    context.page.onLoad();
    assert.equal(context.getLocationCalls(), 0);
    assert.equal(context.page.data.state, 'intro');
    await context.page.handleEnableLocation();
    assert.equal(context.getLocationCalls(), 1);
    assert.equal(requests[0].coordinateSystem, 'GCJ02');
    assert.equal(Object.hasOwn(context.page.data, 'latitude'), false);
    assert.equal(Object.hasOwn(context.page.data, 'longitude'), false);
    assert.ok(context.page._viewerLocation);
    context.page.onHide();
    assert.equal(context.page._viewerLocation, null);
  } finally {
    activityService.nearby = originalNearby;
    unloadNearbyPage(context);
  }
});

test('POI 再搜索时销毁原生地图预览，并阻止旧异步结果覆盖新关键词', async () => {
  const amapService = require('../miniprogram/services/amap');
  const originalSearchPoi = amapService.searchPoi;
  let resolveOldSearch;
  amapService.searchPoi = () => new Promise((resolve) => { resolveOldSearch = resolve; });
  const context = loadLocationPickerPage();
  try {
    context.page.setData({ keyword: '旧地点', selected: { poiId: 'selected' }, showMapPreview: true });
    const pending = context.page.search();
    context.page.handleKeywordInput({ detail: { value: '' } });
    resolveOldSearch([{ poiId: 'old', label: '旧结果' }]);
    assert.equal(await pending, false);
    assert.equal(context.page.data.results.length, 0);
    assert.equal(context.page.data.showMapPreview, false);

    context.page.setData({ results: [{ poiId: 'new', label: '新地点', address: '澳门', latitude: 22.19, longitude: 113.54 }] });
    context.page.handleSelectPoi({ currentTarget: { dataset: { index: 0 } } });
    assert.equal(context.page.data.showMapPreview, true);
    context.page.handleKeywordInput({ detail: { value: '再搜索' } });
    assert.equal(context.page.data.showMapPreview, false);
  } finally {
    if (context.page._searchTimer) clearTimeout(context.page._searchTimer);
    amapService.searchPoi = originalSearchPoi;
    unloadLocationPickerPage(context);
  }
});

test('附近筛选打断续页时会释放 loadingMore 锁并采用最新筛选结果', async () => {
  const originalNearby = activityService.nearby;
  let resolveLoadMore;
  activityService.nearby = (input) => input.cursor
    ? new Promise((resolve) => { resolveLoadMore = resolve; })
    : Promise.resolve({ items: [], nextCursor: null });
  const context = loadNearbyPage();
  try {
    context.page._viewerLocation = { ...ORIGIN };
    context.page._nextCursor = 'old-cursor';
    const pending = context.page.loadMore();
    assert.equal(context.page.data.loadingMore, true);
    await context.page.handleRadiusChange({ currentTarget: { dataset: { value: 5000 } } });
    assert.equal(context.page.data.loadingMore, false);
    resolveLoadMore({ items: [], nextCursor: null });
    assert.equal(await pending, false);
    assert.equal(context.page.data.loadingMore, false);
  } finally {
    activityService.nearby = originalNearby;
    unloadNearbyPage(context);
  }
});
