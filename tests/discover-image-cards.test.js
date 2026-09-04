'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../miniprogram');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function component(fontSizeSetting = 16, fail = false) {
  let definition;
  vm.runInNewContext(read('components/activity-card/index.js'), {
    Component: (value) => { definition = value; },
    wx: { getAppBaseInfo: () => { if (fail) throw new Error('unavailable'); return { fontSizeSetting }; } }
  });
  const instance = { ...definition.methods, data: { ...definition.data, variant: 'discover' },
    setData(patch) { Object.assign(this.data, patch); }, triggerEvent(name, detail) { this.event = { name, detail }; } };
  return { definition, instance, update(item, variant = 'discover') {
    instance.data.item = item; instance.data.variant = variant;
    definition.observers['item, variant'].call(instance, item, variant);
  } };
}

test('发现专用变体默认关闭，三类封面白名单且不接受任意URL', () => {
  const h = component();
  assert.equal(h.definition.properties.variant.value, 'compact');
  for (const type of ['companion', 'sport', 'food']) {
    h.update({ id: type, typeTone: type, cover: 'https://untrusted.invalid/picture' });
    assert.equal(h.instance.data.coverSrc, `/assets/images/publish/publish-cover-${type}.webp`);
    assert.ok(fs.existsSync(path.join(root, h.instance.data.coverSrc)));
  }
  for (const typeTone of ['unknown', 'toString', '__proto__']) {
    h.update({ typeTone });
    assert.equal(h.instance.data.coverSrc, '');
  }
  h.update({ typeTone: 'sport' }, 'compact');
  assert.equal(h.instance.data.coverSrc, '');
});

test('图片错误降级与属性更新隔离，整卡保持select事件', () => {
  const h = component();
  h.update({ id: 'a', typeTone: 'sport' });
  const old = h.instance.data.coverSrc;
  h.instance.handleCoverError({ currentTarget: { dataset: { src: old } } });
  assert.equal(h.instance.data.coverFailed, true);
  h.update({ id: 'b', typeTone: 'food' });
  assert.equal(h.instance.data.coverFailed, false);
  h.instance.handleCoverError({ currentTarget: { dataset: { src: old } } });
  assert.equal(h.instance.data.coverFailed, false);
  h.instance.handleTap();
  assert.equal(h.instance.event.name, 'select');
  assert.equal(h.instance.event.detail.id, 'b');
});

test('字体变大启用流式保护，获取系统信息异常安全降级', () => {
  const h = component(20);
  h.definition.lifetimes.attached.call(h.instance);
  assert.equal(h.instance.data.largeText, true);
  const unavailable = component(16, true);
  unavailable.definition.lifetimes.attached.call(unavailable.instance);
  assert.equal(unavailable.instance.data.largeText, true);
  const normal = component(16);
  normal.definition.lifetimes.attached.call(normal.instance);
  assert.equal(normal.instance.data.largeText, false);
  assert.match(read('components/activity-card/index.wxss'), /\.activity-card--discover\.activity-card--large-text\s*\{\s*align-items:\s*flex-start;/);
});

test('发现启用图文变体与骨架，我的保持默认，图片区懒加载和语义隐藏', () => {
  assert.match(read('pages/discover/index.wxml'), /<activity-card[^>]*variant="discover"/);
  assert.doesNotMatch(read('pages/user/index.wxml'), /variant="discover"/);
  const template = read('components/activity-card/index.wxml');
  assert.match(template, /mode="aspectFit"/);
  assert.match(template, /lazy-load="{{true}}"/);
  assert.match(template, /binderror="handleCoverError"/);
  assert.match(template, /card-cover[^>]*aria-hidden="true"/);
  assert.match(read('pages/discover/index.wxml'), /skeleton-cover/);
  assert.match(read('components/activity-card/index.wxss'), /\.activity-card--discover/);
});

test('发现卡恢复真实头像槽位、折叠容量与一次性成员入场动效', () => {
  const template = read('components/activity-card/index.wxml');
  const style = read('components/activity-card/index.wxss');
  assert.match(template, /wx:for="\{\{item\.visibleAvatarSlots\}\}"/);
  assert.match(template, /class="member-avatar-slot[^\"]*member-avatar-slot--\{\{slot\.empty \? 'empty' : 'filled'\}\}/);
  assert.match(template, /wx:if="\{\{item\.hiddenMemberCount > 0\}\}"[^>]*>\+\{\{item\.hiddenMemberCount\}\}/);
  assert.doesNotMatch(template.split('<view wx:elif')[0], /class="owner-line"/);
  assert.match(style, /@keyframes member-avatar-enter/);
  assert.doesNotMatch(style, /capacity-progress-enter|capacity-arrow-nudge/);
  assert.match(style, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*animation:\s*none;/);
});
