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
  const instance = { ...definition.methods, data: { ...definition.data, variant: 'home-preview' },
    setData(patch) {
      for (const [key, value] of Object.entries(patch)) {
        const match = /^avatarSlots\[(\d+)\]$/.exec(key);
        if (match) this.data.avatarSlots[Number(match[1])] = value;
        else this.data[key] = value;
      }
    }, triggerEvent(name, detail) { this.event = { name, detail }; } };
  return { definition, instance, update(item, variant = 'home-preview') {
    instance.data.item = item; instance.data.variant = variant;
    definition.observers['item, variant'].call(instance, item, variant);
  } };
}

test('首页三列预览变体默认关闭，三类封面白名单且不接受任意URL', () => {
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

test('首页预览卡通过显式属性启用大字流式保护', () => {
  const h = component();
  assert.equal(h.definition.properties.largeText.value, false);
  assert.match(read('components/activity-card/index.wxss'), /\.activity-card--home-preview\.activity-card--large-text\s*\{[^}]*height:\s*auto;/s);
  assert.match(read('pages/discover/index.wxml'), /large-text="\{\{largeTextMode\}\}"/);
});

test('首页启用三列预览变体与同尺寸骨架，我的保持默认，图片区懒加载和语义隐藏', () => {
  assert.match(read('pages/discover/index.wxml'), /<activity-card[^>]*variant="home-preview"/);
  assert.doesNotMatch(read('pages/user/index.wxml'), /variant="home-preview"/);
  const template = read('components/activity-card/index.wxml');
  assert.match(template, /mode="aspectFit"/);
  assert.match(template, /lazy-load="{{true}}"/);
  assert.match(template, /binderror="handleCoverError"/);
  assert.match(template, /home-preview-cover[^>]*aria-hidden="true"/);
  assert.match(read('pages/discover/index.wxml'), /activity-skeleton-cover/);
  assert.match(read('components/activity-card/index.wxss'), /\.activity-card--home-preview/);
});

test('首页三列卡使用发起人行、两行标题、固定插画封面和真实容量', () => {
  const template = read('components/activity-card/index.wxml');
  const style = read('components/activity-card/index.wxss');
  const homePreview = template.split('<view wx:elif')[0];
  assert.match(homePreview, /class="home-preview-owner"/);
  assert.match(homePreview, /item\.ownerNickname/);
  assert.match(homePreview, /item\.editorialDate/);
  assert.match(homePreview, /class="home-preview-title"/);
  assert.match(homePreview, /class="home-preview-cover home-preview-cover--\{\{item\.typeTone\}\}"/);
  assert.match(homePreview, /class="home-preview-capacity"[^>]*>\{\{item\.capacityLabel\}\}/);
  assert.doesNotMatch(homePreview, /item\.sceneLine|item\.displayDescription/);
  assert.match(style, /\.activity-card--home-preview\s*\{[^}]*height:\s*320rpx;[^}]*padding:\s*16rpx 14rpx 14rpx;[^}]*box-shadow:\s*0 6rpx 18rpx rgba\(15, 23, 42, 0\.055\)/s);
  assert.match(style, /\.home-preview-cover\s*\{[^}]*height:\s*132rpx;[^}]*border-radius:\s*14rpx;/s);
  assert.match(style, /\.home-preview-cover-image\s*\{[^}]*width:\s*114rpx;[^}]*height:\s*114rpx;/s);
  assert.match(style, /\.home-preview-title\s*\{[^}]*-webkit-line-clamp:\s*2;[^}]*font-size:\s*24rpx;/s);
  const pageStyle = read('pages/discover/index.wxss');
  assert.match(pageStyle, /\.activity-skeleton-card\s*\{[^}]*height:\s*320rpx;[^}]*background:\s*#fff;[^}]*border-radius:\s*22rpx/s);
  assert.match(style, /\.activity-card--home-preview\.activity-card--large-text\s*\{[^}]*height:\s*auto;/s);
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
