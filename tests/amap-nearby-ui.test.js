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
  const toastCalls = [];
  global.Page = (value) => { definition = value; };
  global.wx = {
    getLocation(options) { getLocationCalls += 1; options.success({ latitude: 22.198745, longitude: 113.543873 }); },
    stopPullDownRefresh() {}, openSetting() {}, redirectTo() {}, navigateTo() {},
    showToast(options) { toastCalls.push(options); }
  };
  const pagePath = require.resolve('../miniprogram/subpackages/activity/nearby/index');
  delete require.cache[pagePath];
  require(pagePath);
  return {
    pagePath,
    getLocationCalls: () => getLocationCalls,
    toastCalls,
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

function loadAmapService(config, requestImpl) {
  const runtimePath = require.resolve('../miniprogram/config/runtime');
  const servicePath = require.resolve('../miniprogram/services/amap');
  const previousRuntime = require.cache[runtimePath];
  const previousService = require.cache[servicePath];
  const previousWx = global.wx;
  require.cache[runtimePath] = { exports: config };
  delete require.cache[servicePath];
  global.wx = { request: requestImpl };
  return {
    service: require(servicePath),
    cleanup() {
      delete require.cache[servicePath];
      if (previousService) require.cache[servicePath] = previousService;
      if (previousRuntime) require.cache[runtimePath] = previousRuntime;
      else delete require.cache[runtimePath];
      if (previousWx) global.wx = previousWx;
      else delete global.wx;
    }
  };
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
  assert.match(amap, /restapi\.amap\.com\/v3\/place\/text/);
  assert.doesNotMatch(amap, /setStorage|setStorageSync/);
});

test('Input Tips 有有效坐标时直接返回且不触发文本检索', async () => {
  const requests = [];
  const context = loadAmapService(
    { useMock: false, amapMiniProgramKey: 'synthetic-key' },
    (options) => {
      requests.push(options);
      options.success({
        statusCode: 200,
        data: { status: '1', tips: [{ id: 'valid', name: '大三巴牌坊', district: '澳门特别行政区花王堂区', address: '耶稣会纪念广场', location: '113.545883,22.194627' }] }
      });
    }
  );
  try {
    const results = await context.service.searchPoi('大三巴');
    assert.equal(results[0].label, '大三巴牌坊');
    assert.equal(results[0].latitude, 22.194627);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, context.service.INPUT_TIPS_URL);
  } finally {
    context.cleanup();
  }
});

test('Input Tips 缺少坐标或为空时由 place/text 补齐真实澳门 POI', async () => {
  const scenarios = [
    [{ id: 'generic', name: '新马路' }],
    []
  ];
  for (const tips of scenarios) {
    const requests = [];
    const context = loadAmapService(
      { useMock: false, amapMiniProgramKey: 'synthetic-key' },
      (options) => {
        requests.push(options);
        if (requests.length === 1) {
          options.success({ statusCode: 200, data: { status: '1', tips } });
          return;
        }
        options.success({
          statusCode: 200,
          data: { status: '1', pois: [{ id: 'poi-text', name: '新马路', pname: '澳门特别行政区', cityname: '澳门特别行政区', adname: '澳门半岛', address: '亚美打利庇卢大马路', location: '113.540941,22.193941' }] }
        });
      }
    );
    try {
      const results = await context.service.searchPoi('新马路');
      assert.equal(requests.length, 2);
      assert.equal(requests[1].url, context.service.POI_TEXT_SEARCH_URL);
      assert.deepEqual(requests[1].data, {
        key: 'synthetic-key',
        keywords: '新马路',
        city: '澳门',
        citylimit: true,
        offset: 20,
        page: 1,
        extensions: 'base'
      });
      assert.equal(results[0].label, '新马路');
      assert.equal(results[0].address, '澳门半岛 · 亚美打利庇卢大马路');
      assert.equal(results[0].longitude, 113.540941);
    } finally {
      context.cleanup();
    }
  }
});

test('两层都为空才返回真实空态，有原始候选但无澳门坐标则保持坐标错误', async () => {
  const emptyResponses = [
    { statusCode: 200, data: { status: '1', tips: [] } },
    { statusCode: 200, data: { status: '1', pois: [] } }
  ];
  const empty = loadAmapService(
    { useMock: false, amapMiniProgramKey: 'synthetic-key' },
    ({ success }) => success(emptyResponses.shift())
  );
  try {
    assert.deepEqual(await empty.service.searchPoi('不存在的地点'), []);
  } finally {
    empty.cleanup();
  }

  const invalidResponses = [
    { statusCode: 200, data: { status: '1', tips: [{ id: 'missing-location', name: '公园' }] } },
    { statusCode: 200, data: { status: '1', pois: [{ id: 'outside-macau', name: '公园', pname: '广东省', cityname: '珠海市', adname: '香洲区', address: '横琴', location: '113.531947,22.197180' }] } }
  ];
  const invalid = loadAmapService(
    { useMock: false, amapMiniProgramKey: 'synthetic-key' },
    ({ success }) => success(invalidResponses.shift())
  );
  try {
    await assert.rejects(invalid.service.searchPoi('公园'), (error) => (
      error.code === 'AMAP_COORDINATES_UNAVAILABLE'
      && !error.message.includes('珠海市')
    ));
  } finally {
    invalid.cleanup();
  }
});

test('Input Tips 网络、响应与 API 失败会安全短路且不触发第二次请求', async () => {
  const networkRequests = [];
  const network = loadAmapService(
    { useMock: false, amapMiniProgramKey: 'synthetic-key' },
    (options) => {
      networkRequests.push(options);
      options.fail({ errMsg: 'request:fail url not in domain list' });
    }
  );
  try {
    await assert.rejects(network.service.searchPoi('澳门大学'), (error) => (
      error.code === 'AMAP_NETWORK_FAILED'
      && error.message === '地点搜索连接失败，请稍后重试'
      && !error.message.includes('domain list')
    ));
    assert.equal(networkRequests.length, 1);
  } finally {
    network.cleanup();
  }

  const responses = [
    { statusCode: 200, data: { status: '1', tips: null } },
    { statusCode: 200, data: { status: '0', info: 'INVALID_USER_KEY', infocode: '10001' } },
    { statusCode: 503, data: { status: '0', info: 'RAW_UPSTREAM_FAILURE' } }
  ];
  for (const response of responses) {
    let requestCount = 0;
    const context = loadAmapService(
      { useMock: false, amapMiniProgramKey: 'synthetic-key' },
      ({ success }) => { requestCount += 1; success(response); }
    );
    try {
      await assert.rejects(context.service.searchPoi('大三巴'), (error) => (
        ['AMAP_RESPONSE_INVALID', 'AMAP_REQUEST_FAILED'].includes(error.code)
        && !error.message.includes('INVALID_USER_KEY')
        && !error.message.includes('RAW_UPSTREAM_FAILURE')
      ));
      assert.equal(requestCount, 1);
    } finally {
      context.cleanup();
    }
  }
});

test('place/text 兜底失败沿用脱敏错误并允许页面重试', async () => {
  const responses = [
    { statusCode: 200, data: { status: '1', tips: [] } },
    { statusCode: 200, data: { status: '0', info: 'DAILY_QUERY_OVER_LIMIT', infocode: '10003' } }
  ];
  const context = loadAmapService(
    { useMock: false, amapMiniProgramKey: 'synthetic-key' },
    ({ success }) => success(responses.shift())
  );
  try {
    await assert.rejects(context.service.searchPoi('咖啡店'), (error) => (
      error.code === 'AMAP_REQUEST_FAILED'
      && error.message === '地点搜索暂时不可用，请稍后重试'
      && !error.message.includes('DAILY_QUERY_OVER_LIMIT')
    ));
  } finally {
    context.cleanup();
  }
});

test('Mock 未命中不会伪装成真实高德零结果', async () => {
  const context = loadAmapService(
    { useMock: true, amapMiniProgramKey: '' },
    () => { throw new Error('Mock 模式不应请求网络'); }
  );
  try {
    await assert.rejects(context.service.searchPoi('大三巴'), (error) => error.code === 'AMAP_MOCK_NO_MATCH');
    const results = await context.service.searchPoi('澳门大学');
    assert.equal(results[0].label, '澳门大学');
  } finally {
    context.cleanup();
  }
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
  assert.match(template, /bindtap="handleRetryNearby"/);
  assert.match(template, /canRetryNearby \? '重新加载' : '重新定位'/);
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
    context.page.setData({ loadingMore: true });
    context.page.onHide();
    assert.equal(context.page._viewerLocation, null);
    assert.equal(context.page.data.loadingMore, false);
  } finally {
    activityService.nearby = originalNearby;
    unloadNearbyPage(context);
  }
});

test('定位曾被拒绝时显示品牌弹窗，取消不索权，确认后复用设置与原定位流程', async () => {
  const originalNearby = activityService.nearby;
  let openSettingCalls = 0;
  activityService.nearby = async () => ({ items: [], nextCursor: null });
  const context = loadNearbyPage();
  global.wx.getSetting = ({ success, complete }) => {
    success({ authSetting: { 'scope.userLocation': false } });
    if (complete) complete();
  };
  global.wx.openSetting = ({ success, complete }) => {
    openSettingCalls += 1;
    success({ authSetting: { 'scope.userLocation': true } });
    if (complete) complete();
  };
  try {
    context.page.onLoad();
    await context.page.handleEnableLocation();
    assert.equal(context.getLocationCalls(), 0);
    assert.equal(context.page.data.modal.type, 'location');
    assert.equal(context.page.data.modal.visible, true);
    context.page.handleModalCancel();
    assert.equal(context.getLocationCalls(), 0);
    assert.equal(openSettingCalls, 0);
    context.page.handleModalClosed();

    context.page.handleOpenSettings();
    context.page.handleModalConfirm();
    assert.equal(openSettingCalls, 1);
    assert.equal(context.page.data.modal.visible, false);
    await context.page.handleModalClosed();
    assert.equal(context.getLocationCalls(), 1);
    assert.equal(context.page.data.state, 'empty');
  } finally {
    activityService.nearby = originalNearby;
    unloadNearbyPage(context);
  }
});

test('跳转系统设置期间切到后台，返回后继续消费授权结果且不重复索权', async () => {
  const originalNearby = activityService.nearby;
  let settingCallbacks;
  let openSettingCalls = 0;
  activityService.nearby = async () => ({ items: [], nextCursor: null });
  const context = loadNearbyPage();
  global.wx.openSetting = (callbacks) => {
    openSettingCalls += 1;
    settingCallbacks = callbacks;
  };
  try {
    context.page.onLoad();
    context.page.onShow();
    context.page.handleOpenSettings();
    context.page.handleModalConfirm();
    assert.equal(openSettingCalls, 1);
    assert.equal(context.page.data.modal.loading, true);

    context.page.onHide();
    settingCallbacks.success({ authSetting: { 'scope.userLocation': true } });
    settingCallbacks.complete();
    assert.equal(context.getLocationCalls(), 0);
    assert.deepEqual(context.page._resumeLocationSettingResult, { granted: true });

    context.page.onShow();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(context.getLocationCalls(), 1);
    assert.equal(context.page.data.state, 'empty');
    assert.equal(context.page._resumeLocationSettingResult, null);
    assert.equal(context.page.data.modal.visible, false);
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

test('POI 选点页区分可重试错误与真实空态，并复用当前关键词重试', async () => {
  const amapService = require('../miniprogram/services/amap');
  const originalSearchPoi = amapService.searchPoi;
  const context = loadLocationPickerPage();
  let calls = 0;
  try {
    context.page.setData({ keyword: '大三巴' });
    amapService.searchPoi = async () => {
      calls += 1;
      if (calls === 1) {
        const error = new Error('地点搜索连接失败，请稍后重试');
        error.code = 'AMAP_NETWORK_FAILED';
        throw error;
      }
      return [{ poiId: 'ruins', label: '大三巴牌坊', address: '花王堂区', latitude: 22.194627, longitude: 113.545883 }];
    };

    assert.equal(await context.page.search(), false);
    assert.equal(context.page.data.errorCode, 'AMAP_NETWORK_FAILED');
    assert.equal(context.page.data.canRetrySearch, true);
    assert.equal(await context.page.handleRetrySearch(), true);
    assert.equal(context.page.data.results[0].label, '大三巴牌坊');
    assert.equal(context.page.data.error, '');

    amapService.searchPoi = async () => [];
    assert.equal(await context.page.search(), true);
    assert.deepEqual(context.page.data.results, []);
    assert.equal(context.page.data.error, '');
    assert.equal(context.page.data.canRetrySearch, false);
  } finally {
    amapService.searchPoi = originalSearchPoi;
    unloadLocationPickerPage(context);
  }
});

test('选点确认仅在 EventChannel 成功回传后返回，通道缺失时留页提示', () => {
  const context = loadLocationPickerPage();
  const selected = { poiId: 'poi-confirmed', label: '澳门大学', address: '大学大马路' };
  const emitted = [];
  const toasts = [];
  let navigateBackCalls = 0;
  global.wx.navigateBack = () => { navigateBackCalls += 1; };
  global.wx.showToast = (options) => { toasts.push(options); };
  context.page.setData({ selected });
  try {
    context.page.getOpenerEventChannel = () => ({ emit(name, payload) { emitted.push({ name, payload }); } });
    assert.equal(context.page.handleConfirm(), true);
    assert.deepEqual(emitted, [{ name: 'meetingPointSelected', payload: selected }]);
    assert.equal(navigateBackCalls, 1);

    context.page.getOpenerEventChannel = () => null;
    assert.equal(context.page.handleConfirm(), false);
    assert.equal(navigateBackCalls, 1);
    assert.equal(toasts.at(-1).title, '地点回传失败，请重试');

    context.page.getOpenerEventChannel = () => ({ emit() { throw new Error('channel closed'); } });
    assert.equal(context.page.handleConfirm(), false);
    assert.equal(navigateBackCalls, 1);
    assert.equal(toasts.at(-1).title, '地点回传失败，请重试');
  } finally {
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

test('附近读取按服务未就绪、网络异常与通用服务异常展示准确文案', async () => {
  const originalNearby = activityService.nearby;
  const context = loadNearbyPage();
  const cases = [
    ['NEARBY_UNAVAILABLE', 'unavailable', '附近活动服务正在准备中，请稍后重试'],
    ['TIMEOUT', 'error', '网络连接不稳定，请稍后重试'],
    ['INTERNAL', 'error', '附近活动暂时无法加载，请稍后重试']
  ];
  try {
    context.page.onLoad();
    context.page._viewerLocation = { ...ORIGIN };
    for (const [code, state, message] of cases) {
      activityService.nearby = async () => { throw Object.assign(new Error('raw cloud failure'), { code }); };
      await context.page.fetchNearby();
      assert.equal(context.page.data.state, state);
      assert.equal(context.page.data.errorMessage, message);
      assert.equal(context.page.data.canRetryNearby, true);
      assert.doesNotMatch(context.page.data.errorMessage, /raw cloud|检查网络/);
    }
  } finally {
    activityService.nearby = originalNearby;
    unloadNearbyPage(context);
  }
});

test('已有有效坐标时重新加载不再次定位，筛选失败保留旧列表', async () => {
  const originalNearby = activityService.nearby;
  let nearbyCalls = 0;
  const context = loadNearbyPage();
  const existing = [{ id: 'existing-nearby' }];
  activityService.nearby = async () => {
    nearbyCalls += 1;
    throw Object.assign(new Error('service failed'), { code: 'INTERNAL' });
  };
  try {
    context.page.onLoad();
    context.page._viewerLocation = { ...ORIGIN };
    context.page.setData({ state: 'error', canRetryNearby: true });
    await context.page.handleRetryNearby();
    assert.equal(nearbyCalls, 1);
    assert.equal(context.getLocationCalls(), 0);

    context.page._nextCursor = 'existing-next-page';
    context.page.setData({ state: 'success', activities: existing, hasMore: true });
    await context.page.handleRadiusChange({ currentTarget: { dataset: { value: 5000 } } });
    assert.equal(context.page.data.state, 'success');
    assert.deepEqual(context.page.data.activities, existing);
    assert.equal(context.page.data.radiusMeters, 3000);
    assert.equal(context.page._nextCursor, 'existing-next-page');
    assert.equal(context.page.data.hasMore, true);
    assert.equal(context.toastCalls.at(-1).title, '附近活动暂时无法加载，请稍后重试');
  } finally {
    activityService.nearby = originalNearby;
    unloadNearbyPage(context);
  }
});
