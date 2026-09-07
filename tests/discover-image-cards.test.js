'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { decorateActivity } = require('../miniprogram/utils/display');
const root = path.join(__dirname, '../miniprogram');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function component(fontSizeSetting = 16, fail = false) {
  let definition;
  vm.runInNewContext(read('components/activity-card/index.js'), {
    Component: (value) => { definition = value; },
    require: createRequire(path.join(root, 'components/activity-card/index.js')),
    wx: { getAppBaseInfo: () => { if (fail) throw new Error('unavailable'); return { fontSizeSetting }; } }
  });
  const instance = { ...definition.methods, data: { ...definition.data, variant: 'discover' },
    setData(patch) {
      for (const [key, value] of Object.entries(patch)) {
        const match = /^avatarSlots\[(\d+)\]$/.exec(key);
        if (match) this.data.avatarSlots[Number(match[1])] = value;
        else this.data[key] = value;
      }
    }, triggerEvent(name, detail) { this.event = { name, detail }; } };
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
    assert.equal(h.instance.data.coverSrc, `/assets/images/publish/publish-cover-${type}.png`);
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

test('发现卡使用左右画报分栏、大日期、真实发起人与可选说明', () => {
  const template = read('components/activity-card/index.wxml');
  const style = read('components/activity-card/index.wxss');
  const discoverTemplate = template.split('<view wx:elif')[0];
  assert.match(discoverTemplate, /class="card-cover-type/);
  assert.match(discoverTemplate, /class="card-cover-scrim/);
  assert.match(discoverTemplate, /item\.editorialDate/);
  assert.match(discoverTemplate, /item\.editorialWeekday/);
  assert.match(discoverTemplate, /item\.editorialTime/);
  assert.match(discoverTemplate, /class="owner-line"/);
  assert.match(discoverTemplate, /wx:if="\{\{item\.displayDescription\}\}"[^>]*class="activity-description"/);
  assert.match(template, /wx:for="\{\{avatarSlots\}\}"/);
  assert.match(template, /class="member-avatar-slot[^\"]*member-avatar-slot--\{\{slot\.empty \? 'empty' : 'filled'\}\}/);
  assert.match(template, /wx:if="\{\{item\.hiddenMemberCount > 0\}\}"[^>]*>\+\{\{item\.hiddenMemberCount\}\}/);
  assert.match(style, /\.activity-card--discover\s*\{[^}]*align-items:\s*stretch;[^}]*min-height:\s*390rpx;[^}]*box-shadow:\s*0 5rpx 16rpx/s);
  assert.match(style, /\.activity-card--discover \.card-cover\s*\{[^}]*flex:\s*0 0 46%;[^}]*min-height:\s*390rpx;/s);
  assert.match(style, /\.activity-card--discover \.card-cover-image\s*\{[^}]*top:\s*46rpx;[^}]*width:\s*230rpx;[^}]*height:\s*230rpx;/s);
  assert.match(style, /\.activity-card--discover \.card-copy\s*\{[^}]*flex:\s*0 0 54%;[^}]*width:\s*54%;[^}]*padding:\s*22rpx 20rpx 20rpx;/s);
  assert.match(style, /\.card-cover-scrim\s*\{[^}]*height:\s*52%;[^}]*rgba\(6, 23, 42, 0\.85\)/s);
  assert.match(style, /\.editorial-date\s*\{[^}]*font-size:\s*36rpx;[^}]*font-weight:\s*900;/s);
  assert.match(style, /\.activity-description\s*\{[^}]*padding:\s*8rpx 14rpx;[^}]*background:\s*#faf7f2;[^}]*border:\s*1rpx solid #eee8de;/s);
  const pageStyle = read('pages/discover/index.wxss');
  assert.match(pageStyle, /\.skeleton-card\s*\{[^}]*min-height:\s*390rpx;[^}]*background:\s*#fff;[^}]*border-radius:\s*24rpx/s);
  assert.match(pageStyle, /\.skeleton-cover\s*\{[^}]*flex:\s*0 0 46%;[^}]*background:\s*#ebe6de;/s);
  assert.match(style, /\.activity-card--discover\.activity-card--large-text\s*\{[^}]*flex-direction:\s*column;/s);
  assert.match(style, /@keyframes member-avatar-enter/);
  assert.doesNotMatch(style, /capacity-progress-enter|capacity-arrow-nudge/);
  assert.match(style, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*animation:\s*none;/);
});

test('活动装饰层只从真实开始时间生成单点日期并清洗可选说明', () => {
  const item = decorateActivity({
    id: 'editorial', type: 'sport', title: '周末羽毛球', description: '  新手友好  ',
    startsAt: '2026-09-06T19:30:00+08:00', memberCount: 1, maxMembers: 4,
    status: 'RECRUITING', placeLabel: '附近体育馆', owner: { nickname: '旧名称' },
    ownerProfile: { nickname: '小拼', avatar: { kind: 'DEFAULT', fallback: 'FEMALE_DEFAULT' } },
    avatarSlots: [], typeData: { category: '羽毛球', venue: '附近体育馆' }
  });
  assert.match(item.editorialDate, /^\d{2}\.\d{2}$/);
  assert.match(item.editorialWeekday, /^周[日一二三四五六]$/);
  assert.match(item.editorialTime, /^\d{2}:\d{2}$/);
  assert.equal(item.displayDescription, '新手友好');
  assert.equal(item.ownerNickname, '小拼');
  assert.doesNotMatch(`${item.editorialDate}${item.editorialTime}`, /[-–—]/);
});

test('发现卡优先渲染发起人真实公开头像', () => {
  const h = component();
  h.update({
    id: 'owner-profile-avatar', typeTone: 'food', visibleAvatarSlots: [],
    ownerProfile: { avatar: { kind: 'DEFAULT', fallback: 'FEMALE_DEFAULT' } }
  });
  assert.equal(h.instance.data.ownerAvatar.kind, 'DEFAULT');
  assert.match(h.instance.data.ownerAvatar.src, /profile-avatar-female-painted\.png$/);
  assert.equal(h.instance.data.ownerAvatar.id, 'owner-avatar');
});

test('真实头像失败只降级一次到本地手绘头像', () => {
  const h = component();
  h.update({
    id: 'custom-avatar',
    typeTone: 'sport',
    visibleAvatarSlots: [{
      id: 'slot-1', kind: 'CUSTOM', src: 'https://example.test/avatar.jpg',
      fallbackSrc: '/assets/images/profile/profile-avatar-female-painted.png',
      custom: true, failed: false, mode: 'aspectFill', empty: false
    }]
  });
  h.instance.handleAvatarError({ currentTarget: { dataset: { index: 0, slotId: 'slot-1', src: 'https://example.test/avatar.jpg' } } });
  assert.equal(h.instance.data.avatarSlots[0].kind, 'DEFAULT');
  assert.equal(h.instance.data.avatarSlots[0].failed, true);
  assert.match(h.instance.data.avatarSlots[0].src, /profile-avatar-female-painted\.png$/);
  const once = h.instance.data.avatarSlots[0];
  h.instance.handleAvatarError({ currentTarget: { dataset: { index: 0, slotId: 'slot-1', src: 'https://example.test/avatar.jpg' } } });
  assert.equal(h.instance.data.avatarSlots[0], once);
});

test('头像错误事件在卡片复用后不修改同索引的新头像', () => {
  const h = component();
  h.update({ id: 'first', typeTone: 'sport', visibleAvatarSlots: [{
    id: 'slot-1', kind: 'CUSTOM', src: 'https://example.test/old.jpg', fallbackSrc: '/assets/images/profile/profile-avatar-male-painted.png', custom: true, failed: false, mode: 'aspectFill', empty: false
  }] });
  h.update({ id: 'second', typeTone: 'sport', visibleAvatarSlots: [{
    id: 'slot-1', kind: 'CUSTOM', src: 'https://example.test/new.jpg', fallbackSrc: '/assets/images/profile/profile-avatar-female-painted.png', custom: true, failed: false, mode: 'aspectFill', empty: false
  }] });
  h.instance.handleAvatarError({ currentTarget: { dataset: { index: 0, slotId: 'slot-1', src: 'https://example.test/old.jpg' } } });
  assert.equal(h.instance.data.avatarSlots[0].src, 'https://example.test/new.jpg');
  assert.equal(h.instance.data.avatarSlots[0].kind, 'CUSTOM');
});
