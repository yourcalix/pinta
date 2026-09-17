'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../miniprogram');
const MODAL_ROOT = path.join(ROOT, 'components/pinba-modal');
const ASSET_ROOT = path.join(ROOT, 'assets/images/brand-modal');
const TYPES = ['success', 'food', 'sport', 'order', 'travel', 'location', 'delete', 'network'];

function loadComponent() {
  let definition;
  global.Component = (value) => { definition = value; };
  const componentPath = require.resolve('../miniprogram/components/pinba-modal/index');
  delete require.cache[componentPath];
  const exported = require(componentPath);
  delete global.Component;
  return { definition, exported, componentPath };
}

function componentInstance(definition, properties = {}) {
  const propertyData = Object.fromEntries(Object.entries(definition.properties).map(([key, config]) => [key, config.value]));
  const events = [];
  const instance = {
    data: { ...propertyData, ...definition.data, ...properties },
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); },
    triggerEvent(name, detail) { events.push({ name, detail }); },
    ...definition.methods
  };
  return { instance, events };
}

test('品牌弹窗八类插画均为主包 240px 透明 PNG 且总体积受控', () => {
  let total = 0;
  TYPES.forEach((type) => {
    const file = path.join(ASSET_ROOT, `${type}.png`);
    const bytes = fs.readFileSync(file);
    assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(bytes.readUInt32BE(16), 240);
    assert.equal(bytes.readUInt32BE(20), 240);
    const colorType = bytes[25];
    const hasTransparency = colorType === 4 || colorType === 6 || bytes.includes(Buffer.from('tRNS'));
    assert.equal(hasTransparency, true, `${type}.png 必须保留透明通道`);
    assert.ok(bytes.length <= 11 * 1024, `${type}.png 体积过大`);
    total += bytes.length;
  });
  assert.ok(total <= 76 * 1024, `品牌弹窗插画总体积 ${total} bytes`);
});

test('组件提供八类绝对路径映射、隔离样式与完整事件契约', () => {
  const { definition, exported } = loadComponent();
  TYPES.forEach((type) => assert.equal(exported.TYPE_IMAGES[type], `/assets/images/brand-modal/${type}.png`));
  assert.equal(definition.options.styleIsolation, 'isolated');
  const template = fs.readFileSync(path.join(MODAL_ROOT, 'index.wxml'), 'utf8');
  const style = fs.readFileSync(path.join(MODAL_ROOT, 'index.wxss'), 'utf8');
  assert.match(template, /catchtap="handleMaskTap"/);
  assert.match(template, /class="pinba-modal-card[^\"]*"[\s\S]*catchtap="noop"/);
  assert.match(template, /bindtap="handleConfirm"/);
  assert.match(template, /bindtap="handleCancel"/);
  assert.match(style, /env\(safe-area-inset-bottom\)/);
  assert.doesNotMatch(style, /pinba-modal-art[^}]*animation[^;]*infinite/s);
});

test('危险弹窗不响应遮罩、loading 防重复且取消与遮罩事件互不重复', () => {
  const { definition } = loadComponent();
  const { instance, events } = componentInstance(definition, { rendered: true, visible: true, opened: true, danger: true, closeOnMask: true });
  instance.handleMaskTap();
  assert.deepEqual(events, []);
  instance.data.danger = false;
  instance.handleMaskTap();
  assert.deepEqual(events, [{ name: 'close', detail: { source: 'mask' } }]);
  instance.data.loading = true;
  instance.handleConfirm();
  instance.handleCancel();
  assert.equal(events.length, 1);
  instance.data.loading = false;
  instance.handleCancel();
  instance.handleConfirm();
  assert.deepEqual(events.slice(1).map((event) => event.name), ['cancel', 'confirm']);
});

test('组件关闭时保留退场 DOM，计时结束后卸载并只触发一次 closed', async () => {
  const { definition } = loadComponent();
  const { instance, events } = componentInstance(definition, { rendered: true, visible: false, opened: true });
  instance.close();
  assert.equal(instance.data.rendered, true);
  assert.equal(instance.data.opened, false);
  await new Promise((resolve) => setTimeout(resolve, 245));
  assert.equal(instance.data.rendered, false);
  assert.deepEqual(events.map((event) => event.name), ['closed']);
  instance._disposed = true;
  instance.clearTimers();
});
