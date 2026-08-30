'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const assetRoot = path.resolve(__dirname, '../miniprogram/assets/images/discover');
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const EXPECTED_ASSETS = {
  'hero-campus.png': [720, 540],
  'brand-puzzle.png': [144, 144],
  'ride-car-green.png': [192, 192],
  'node-start-green.png': [144, 144],
  'node-start-blue.png': [144, 144],
  'node-end-taipa.png': [144, 144],
  'node-end-golden-dragon.png': [144, 144],
  'phone-section-handset.png': [144, 144],
  'route-section-pin.png': [144, 144],
  'avatar-passenger-a.png': [144, 144],
  'avatar-passenger-b.png': [144, 144],
  'avatar-passenger-empty.png': [144, 144],
  'tab-discover-active.png': [96, 96],
  'tab-discover-inactive.png': [96, 96],
  'tab-community-active.png': [96, 96],
  'tab-community-inactive.png': [96, 96],
  'tab-publish-active.png': [96, 96],
  'tab-publish-inactive.png': [96, 96],
  'tab-user-active.png': [96, 96],
  'tab-user-inactive.png': [96, 96]
};

function inspectPng(filename) {
  const bytes = fs.readFileSync(path.join(assetRoot, filename));
  assert.deepEqual([...bytes.subarray(0, 8)], PNG_SIGNATURE, `${filename} 必须是标准 PNG`);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const colorType = bytes[25];
  const hasAlpha = colorType === 4
    || colorType === 6
    || bytes.includes(Buffer.from('tRNS'));
  return { bytes, width, height, hasAlpha };
}

test('发现页体素素材使用稳定英文文件名、约定尺寸和真实透明通道', () => {
  const actualNames = fs.readdirSync(assetRoot).filter((name) => name.endsWith('.png')).sort();
  const expectedNames = Object.keys(EXPECTED_ASSETS).sort();
  assert.deepEqual(actualNames, expectedNames);

  expectedNames.forEach((filename) => {
    const asset = inspectPng(filename);
    assert.deepEqual([asset.width, asset.height], EXPECTED_ASSETS[filename], `${filename} 尺寸不符合约定`);
    assert.equal(asset.hasAlpha, true, `${filename} 必须具备透明通道`);
  });
});

test('四个 Tab 与发现页体素素材总量保持在主包安全预算内', () => {
  let totalBytes = 0;
  Object.keys(EXPECTED_ASSETS).forEach((filename) => {
    totalBytes += inspectPng(filename).bytes.length;
  });
  assert.ok(totalBytes <= 480 * 1024, `发现页与四个 Tab 体素素材总量为 ${totalBytes} bytes`);
});

test('Tab 状态图标成对使用同一画布尺寸且内容不重复', () => {
  ['discover', 'community', 'publish', 'user'].forEach((tab) => {
    const active = inspectPng(`tab-${tab}-active.png`);
    const inactive = inspectPng(`tab-${tab}-inactive.png`);
    assert.deepEqual([active.width, active.height], [inactive.width, inactive.height]);
    assert.notDeepEqual(active.bytes, inactive.bytes, `${tab} 激活与未激活图标不能完全相同`);
  });
});
