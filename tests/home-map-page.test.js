'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function jpegInfo(file) {
  const buffer = fs.readFileSync(path.join(root, file));
  let offset = 2;
  while (offset + 9 <= buffer.length) {
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return {
        bytes: buffer.length,
        marker,
        width: buffer.readUInt16BE(offset + 7),
        height: buffer.readUInt16BE(offset + 5)
      };
    }
    offset += 2 + length;
  }
  throw new Error(`无法读取 JPEG 信息：${file}`);
}

function loadMapPage() {
  let definition;
  const navigations = [];
  const toasts = [];
  const originalPage = global.Page;
  const originalWx = global.wx;

  global.Page = (value) => { definition = value; };
  global.wx = {
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    getMenuButtonBoundingClientRect: () => ({ top: 24, bottom: 56 }),
    navigateTo(options) { navigations.push(options); },
    navigateBack() {},
    switchTab() {},
    showToast(options) { toasts.push(options); }
  };

  const pagePath = require.resolve('../miniprogram/subpackages/map/index/index');
  delete require.cache[pagePath];
  require(pagePath);

  return {
    pagePath,
    navigations,
    toasts,
    page: {
      ...definition,
      data: { ...definition.data },
      setData(value) { Object.assign(this.data, value); }
    },
    restore() {
      delete require.cache[pagePath];
      if (originalPage === undefined) delete global.Page;
      else global.Page = originalPage;
      if (originalWx === undefined) delete global.wx;
      else global.wx = originalWx;
    }
  };
}

test('拼吧地图注册为独立分包并使用固定视口自定义导航', () => {
  const app = JSON.parse(read('app.json'));
  const mapPackage = app.subPackages.find((item) => item.root === 'subpackages/map');
  const config = JSON.parse(read('subpackages/map/index/index.json'));
  assert.ok(mapPackage);
  assert.ok(mapPackage.pages.includes('index/index'));
  assert.equal(config.navigationStyle, 'custom');
  assert.equal(config.disableScroll, true);
  assert.equal(config.enablePullDownRefresh, false);
  assert.equal(config.backgroundColor.toLowerCase(), '#f6f2ea');
});

test('地图完整等比展示并只为四块业务木牌建立热点', () => {
  const template = read('subpackages/map/index/index.wxml');
  const style = read('subpackages/map/index/index.wxss');
  const script = read('subpackages/map/index/index.js');

  assert.match(template, /src="\.\/assets\/pinba-map\.jpg"[^>]*mode="widthFix"[^>]*aria-hidden="true"/);
  assert.deepEqual(
    [...template.matchAll(/data-type="(companion|sport|food|benefit)"/g)].map((match) => match[1]),
    ['companion', 'sport', 'food', 'benefit']
  );
  assert.match(template, /拼同行[\s\S]*拼运动[\s\S]*拼饭桌[\s\S]*拼享惠/);
  assert.match(template, /点击木牌，探索不同拼法/);
  assert.doesNotMatch(template, /拼露营|拼户外/);
  assert.match(style, /\.map-canvas,[\s\S]*\.map-hotspot-canvas\s*\{[^}]*width:\s*100vw;[^}]*height:\s*177\.7[0-9]vw;/s);
  assert.match(style, /\.map-marker--companion\s*\{[^}]*left:\s*42%;[^}]*top:\s*8\.4%;/s);
  assert.match(style, /\.map-marker--sport\s*\{[^}]*left:\s*83\.2%;[^}]*top:\s*28\.8%;/s);
  assert.match(style, /\.map-marker--food\s*\{[^}]*left:\s*37%;[^}]*top:\s*34\.2%;/s);
  assert.match(style, /\.map-marker--benefit\s*\{[^}]*left:\s*84\.8%;[^}]*top:\s*79\.6%;/s);
  assert.match(style, /\.map-marker\s*\{[^}]*width:\s*108rpx;[^}]*height:\s*88rpx;/s);
  assert.match(style, /color:\s*#3b2211/i);
  assert.doesNotMatch(template, /aspectFill/);
  assert.doesNotMatch(script, /getLocation|openLocation|createMapContext/);
});

test('地图素材保持 750 宽 Baseline JPEG 且分包拥有充足余量', () => {
  const map = jpegInfo('subpackages/map/index/assets/pinba-map.jpg');
  assert.equal(map.width, 750);
  assert.equal(map.height, 1333);
  assert.equal(map.marker, 0xc0);
  assert.ok(map.bytes < 350 * 1024, `地图素材 ${map.bytes} bytes 应小于 350KB`);
});

test('地图热点只接受四种白名单类型并防止连点重复入栈', () => {
  const context = loadMapPage();
  try {
    context.page.onLoad();
    assert.equal(context.page.data.contentTopInset, 68);
    const event = { currentTarget: { dataset: { type: 'sport' } } };
    assert.equal(context.page.handleTypeSelect(event), true);
    assert.equal(context.page.handleTypeSelect(event), false);
    assert.equal(context.navigations.length, 1);
    assert.equal(context.navigations[0].url, '/subpackages/activity/list/index?type=sport');

    context.navigations[0].fail();
    assert.equal(context.toasts.at(-1).title, '页面打开失败，请稍后重试');
    assert.equal(context.page.handleTypeSelect({ currentTarget: { dataset: { type: 'unknown' } } }), false);
    assert.equal(context.navigations.length, 1);

    context.page.onShow();
    assert.equal(context.page.handleTypeSelect(event), true);
  } finally {
    context.restore();
  }
});
