'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const ROOT = path.join(__dirname, '../miniprogram');
const ACTIVITY_ROOT = path.join(ROOT, 'subpackages/activity');
const ASSET_ROOT = path.join(ACTIVITY_ROOT, 'assets/images/progress-cards/meal');
const COMPONENT_ROOT = path.join(ACTIVITY_ROOT, 'components/leju-progress-card');
const MEAL_STAGES = [
  'MEAL_REGISTERED',
  'MEAL_TEAM_READY',
  'MEAL_MENU_READY',
  'MEAL_ACTIVE',
  'MEAL_CHECKPOINT',
  'MEAL_FINISHED'
];

function jpegFrameMarker(buffer) {
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    if (marker === 0xc0 || marker === 0xc2) return marker;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) break;
    offset += 2 + length;
  }
  return null;
}

function jpegDimensions(buffer) {
  let offset = 2;
  while (offset + 9 <= buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) break;
    offset += 2 + length;
  }
  return null;
}

function loadComponent() {
  let definition;
  global.Component = (value) => { definition = value; };
  const componentPath = require.resolve('../miniprogram/subpackages/activity/components/leju-progress-card/index');
  delete require.cache[componentPath];
  const exported = require(componentPath);
  delete global.Component;
  return { definition, exported };
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

function storagePlatform() {
  const state = {};
  return {
    state,
    getStorageSync(key) { return state[key]; },
    setStorageSync(key, value) { state[key] = structuredClone(value); }
  };
}

test('六张拼好饭卡按原比例转为受控 Baseline JPEG，图片未裁切', () => {
  const { getProgressCard } = require('../miniprogram/subpackages/activity/config/progress-cards');
  let total = 0;
  MEAL_STAGES.forEach((stage) => {
    const card = getProgressCard(stage);
    assert.ok(card, stage);
    assert.match(card.image, /^\/subpackages\/activity\/assets\/images\/progress-cards\/meal\/[a-z-]+\.jpg$/);
    const file = path.join(ROOT, card.image.slice(1));
    const buffer = fs.readFileSync(file);
    assert.deepEqual([...buffer.subarray(0, 3)], [0xff, 0xd8, 0xff], stage);
    assert.equal(jpegFrameMarker(buffer), 0xc0, `${stage} 必须为 Baseline JPEG`);
    assert.deepEqual(jpegDimensions(buffer), { width: 900, height: 1125 }, `${stage} 必须保持 1122:1402 的原始比例`);
    assert.ok(buffer.length <= 220 * 1024, `${stage} 体积 ${buffer.length} 超过 220KB`);
    total += buffer.length;
  });
  assert.ok(total <= 1.15 * 1024 * 1024, `六张进程卡总体积 ${total} 过大`);
  assert.deepEqual(new Set(fs.readdirSync(ASSET_ROOT)), new Set(MEAL_STAGES.map((stage) => path.basename(getProgressCard(stage).image))));
});

test('阶段裁决只消费拼好饭权威状态，不伪造点单或打卡', () => {
  const { resolveProgressStage } = require('../miniprogram/subpackages/activity/utils/progress-resolver');
  const member = { id: 'a1', type: 'food', viewerRole: 'member', status: 'RECRUITING' };
  assert.equal(resolveProgressStage(member), 'MEAL_REGISTERED');
  assert.equal(resolveProgressStage({ ...member, status: 'FORMED' }), 'MEAL_TEAM_READY');
  assert.equal(resolveProgressStage({ ...member, status: 'IN_PROGRESS' }), 'MEAL_ACTIVE');
  assert.equal(resolveProgressStage({ ...member, status: 'COMPLETED' }), 'MEAL_FINISHED');
  assert.equal(resolveProgressStage({ ...member, status: 'CANCELLED' }), null);
  assert.equal(resolveProgressStage({ ...member, viewerRole: 'guest' }), null);
  assert.equal(resolveProgressStage({ ...member, type: 'sport' }), null);
  assert.equal(resolveProgressStage({ ...member, type: 'product' }), null);
  assert.equal(resolveProgressStage({ ...member, status: 'FORMED', typeData: { menuConfirmed: false } }), 'MEAL_TEAM_READY');
  assert.notEqual(resolveProgressStage({ ...member, status: 'FORMED' }), 'MEAL_MENU_READY');
  assert.notEqual(resolveProgressStage({ ...member, status: 'IN_PROGRESS' }), 'MEAL_CHECKPOINT');
});

test('seen 与 snooze 按私有 actor scope 隔离，摘要存储不泄露原值且阻止阶段倒退', () => {
  const state = require('../miniprogram/subpackages/activity/services/progress-storage');
  const platform = storagePlatform();
  const base = { activityId: 'activity-private-123', stage: 'MEAL_ACTIVE', rank: 3 };
  const options = { platform, actorScope: 'session-private-alice', now: 1_000_000 };
  assert.equal(state.shouldPresent(base, options), true);
  state.snooze(base, options);
  assert.equal(state.shouldPresent(base, { ...options, now: options.now + state.SNOOZE_DURATION_MS - 1 }), false);
  assert.equal(state.shouldPresent(base, { ...options, now: options.now + state.SNOOZE_DURATION_MS + 1 }), true);
  assert.equal(state.shouldPresent(base, { ...options, actorScope: 'session-private-bob' }), true);
  state.markSeen(base, { ...options, now: options.now + state.SNOOZE_DURATION_MS + 2 });
  assert.equal(state.shouldPresent(base, { ...options, now: options.now + state.SNOOZE_DURATION_MS + 3 }), false);
  assert.equal(state.shouldPresent({ ...base, stage: 'MEAL_TEAM_READY', rank: 1 }, { ...options, now: options.now + state.SNOOZE_DURATION_MS + 3 }), false);
  assert.equal(state.shouldPresent({ ...base, stage: 'MEAL_FINISHED', rank: 5 }, { ...options, now: options.now + state.SNOOZE_DURATION_MS + 3 }), true);
  const serialized = JSON.stringify(platform.state);
  assert.doesNotMatch(serialized, /session-private-alice|activity-private-123/);
});

test('损坏的进程缓存按最旧记录优先淘汰，同级最高已读可阻止重复展示', () => {
  const state = require('../miniprogram/subpackages/activity/services/progress-storage');
  const platform = storagePlatform();
  const candidate = { activityId: 'same-rank', stage: 'MEAL_ACTIVE', rank: 3 };
  const key = state.storageRecordKey('actor', candidate.activityId);
  const oversized = Object.fromEntries(Array.from({ length: state.MAX_RECORDS }, (_, index) => [
    `valid-${index}`,
    { highestSeenRank: -1, stages: {}, updatedAt: index + 1 }
  ]));
  oversized.corrupt = { highestSeenRank: -1, stages: {}, updatedAt: 'not-a-date' };
  oversized[key] = { highestSeenRank: 3, stages: {}, updatedAt: 999_999 };
  platform.state[state.STORAGE_KEY] = oversized;
  assert.equal(state.shouldPresent(candidate, { platform, actorScope: 'actor', now: 1_000_000 }), false);
  state.snooze({ activityId: 'new-activity', stage: 'MEAL_REGISTERED', rank: 0 }, { platform, actorScope: 'actor', now: 1_000_001 });
  const records = platform.state[state.STORAGE_KEY];
  assert.equal(Object.prototype.hasOwnProperty.call(records, 'corrupt'), false);
  assert.ok(Object.keys(records).length <= state.MAX_RECORDS);
});

test('进程卡组件等待图片就绪再入场，退场后卸载并区分三个动作', async () => {
  const { definition, exported } = loadComponent();
  assert.equal(definition.options.styleIsolation, 'isolated');
  const { instance, events } = componentInstance(definition, {
    visible: true,
    image: '/subpackages/activity/assets/images/progress-cards/meal/registered.jpg',
    stage: 'MEAL_REGISTERED',
    title: '报名成功'
  });
  definition.lifetimes.attached.call(instance);
  assert.equal(instance.data.rendered, true);
  assert.equal(instance.data.opened, false);
  instance.handleImageLoad();
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(instance.data.opened, true);
  instance.handleCollect();
  instance.handleCollect();
  assert.deepEqual(events.map((event) => event.name), ['collect']);
  const later = componentInstance(definition, { visible: true, stage: 'MEAL_REGISTERED' });
  definition.lifetimes.attached.call(later.instance);
  later.instance.handleLater();
  assert.deepEqual(later.events.map((event) => event.name), ['later']);
  definition.lifetimes.detached.call(later.instance);
  const close = componentInstance(definition, { visible: true, stage: 'MEAL_REGISTERED' });
  definition.lifetimes.attached.call(close.instance);
  close.instance.handleClose();
  assert.deepEqual(close.events.map((event) => event.name), ['close']);
  definition.lifetimes.detached.call(close.instance);
  instance.data.visible = false;
  instance.handleVisibilityChange(false);
  await new Promise((resolve) => setTimeout(resolve, exported.CLOSE_DURATION_MS + 30));
  assert.equal(instance.data.rendered, false);
  assert.equal(events.at(-1).name, 'closed');
  definition.lifetimes.detached.call(instance);
});

test('组件图片失败只上报一次，模板不裁图且操作热区与无障碍完整', () => {
  const { definition } = loadComponent();
  const { instance, events } = componentInstance(definition, { visible: true, stage: 'MEAL_ACTIVE' });
  definition.lifetimes.attached.call(instance);
  instance.handleImageError();
  instance.handleImageError();
  assert.deepEqual(events.map((event) => event.name), ['imageerror']);
  const template = fs.readFileSync(path.join(COMPONENT_ROOT, 'index.wxml'), 'utf8');
  const style = fs.readFileSync(path.join(COMPONENT_ROOT, 'index.wxss'), 'utf8');
  assert.match(template, /mode="widthFix"/);
  assert.match(template, /aria-role="dialog"/);
  assert.match(template, /aria-hidden="true"/);
  assert.match(template, /bindtap="handleCollect"/);
  assert.match(template, /aria-label="收下卡片"/);
  assert.match(template, /bindtap="handleLater"/);
  assert.match(template, /bindtap="handleClose"/);
  assert.match(template, /leju-progress-close__surface/);
  assert.match(template, /leju-progress-caption__rays--left/);
  assert.match(template, /leju-progress-caption__rays--right/);
  assert.doesNotMatch(template, /leju-progress-sparks/);
  assert.ok(template.indexOf('handleCollect') < template.indexOf('handleLater'), '主操作应位于次操作之前');
  assert.match(style, /max-height:\s*82vh/);
  assert.match(style, /min-height:\s*88rpx/);
  assert.match(style, /rgba\(15,\s*20,\s*17,\s*\.74\)/);
  assert.match(style, /linear-gradient\(180deg,\s*#FFE785 0%,\s*#FFBA2E 52%,\s*#FFA812 100%\)/);
  assert.match(style, /color:\s*#124A2E/);
  assert.match(style, /\.leju-progress-close__surface\s*\{[\s\S]*width:\s*68rpx[\s\S]*height:\s*68rpx/);
  assert.match(style, /\.leju-progress-caption__ray\s*\{/);
  assert.match(style, /@media\s*\(max-width:\s*340px\),\s*\(max-height:\s*680px\)/);
  assert.match(style, /\.leju-progress-actions\s*\{[\s\S]*flex-direction:\s*column/);
  assert.match(style, /\.leju-progress-button--collect\s*\{[\s\S]*border-radius:\s*999rpx/);
  assert.match(style, /\.leju-progress-button--later\s*\{[\s\S]*background:\s*transparent/);
  assert.doesNotMatch(style, /filter:\s*drop-shadow/);
  assert.doesNotMatch(style, /animation[^;]*infinite/);
  definition.lifetimes.detached.call(instance);
});

test('活动详情只挂载一个低优先级进程卡并保留现有高优先级浮层', () => {
  const script = fs.readFileSync(path.join(ACTIVITY_ROOT, 'detail/index.js'), 'utf8');
  const template = fs.readFileSync(path.join(ACTIVITY_ROOT, 'detail/index.wxml'), 'utf8');
  const config = JSON.parse(fs.readFileSync(path.join(ACTIVITY_ROOT, 'detail/index.json'), 'utf8'));
  assert.equal(config.usingComponents['leju-progress-card'], '/subpackages/activity/components/leju-progress-card/index');
  assert.equal((template.match(/<leju-progress-card\b/g) || []).length, 1);
  assert.match(template, /<pinba-modal[\s\S]*meetingPointModalVisible/);
  assert.match(template, /wx:if="\{\{showApply\}\}"/);
  assert.match(script, /resolveProgressStage/);
  assert.match(script, /showApply[\s\S]*meetingPointModalVisible|meetingPointModalVisible[\s\S]*showApply/);
  assert.match(script, /clearProgressCardTimer/);
  assert.match(script, /progressStorage\.markSeen/);
  assert.match(script, /progressStorage\.snooze/);
});

test('详情先渲染业务数据再低优先级展示，申请抽屉打开时排队让行', async () => {
  const filename = path.join(ACTIVITY_ROOT, 'detail/index.js');
  const source = fs.readFileSync(filename, 'utf8');
  const nativeRequire = createRequire(filename);
  const timers = new Map();
  const calls = { login: 0, seen: 0, snooze: 0 };
  let timerId = 0;
  let definition;
  const activity = {
    id: 'food-activity', type: 'food', title: '一起吃饭', status: 'FORMED', viewerRole: 'member',
    minMembers: 2, maxMembers: 6, memberCount: 3, typeData: { venue: '春风饭店', cuisine: '粤菜' }
  };
  const progressStorage = {
    hasActorScope: () => false,
    shouldPresent: () => true,
    markSeen: () => { calls.seen += 1; },
    snooze: () => { calls.snooze += 1; }
  };
  vm.runInNewContext(source, {
    Page(value) { definition = value; },
    wx: { showShareMenu() {}, showToast() {}, navigateTo() {}, switchTab() {} },
    getCurrentPages: () => [{}],
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    require(name) {
      if (name.endsWith('services/activity')) return { detail: async () => ({ activity }) };
      if (name.endsWith('services/user')) return { login: async () => { calls.login += 1; return { profile: { adultConfirmed: true } }; } };
      if (name.endsWith('services/direct-message')) return {};
      if (name.endsWith('services/progress-storage')) return progressStorage;
      return nativeRequire(name);
    }
  });
  function setPath(target, key, value) {
    const parts = key.split('.');
    let cursor = target;
    parts.slice(0, -1).forEach((part) => { cursor = cursor[part]; });
    cursor[parts.at(-1)] = value;
  }
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch, callback) {
      Object.entries(patch).forEach(([key, value]) => key.includes('.') ? setPath(this.data, key, value) : this.data[key] = value);
      if (callback) callback();
    }
  };
  page.onLoad({ id: 'food-activity' });
  await page.onShow();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.data.activity.id, 'food-activity');
  assert.equal(page.data.progressCard.visible, false);
  assert.equal(calls.login, 1);
  assert.equal(timers.size, 1);
  page.data.showApply = true;
  [...timers.values()][0]();
  timers.clear();
  assert.equal(page.data.progressCard.visible, false);
  page.handleApplyClose();
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  timers.clear();
  assert.equal(page.data.progressCard.visible, true);
  assert.equal(page.data.progressCard.stage, 'MEAL_TEAM_READY');
  page.handleProgressCollect();
  assert.equal(calls.seen, 1);
  assert.equal(page.data.progressCard.visible, false);
  page.onHide();
  assert.equal(timers.size, 0);
});

test('申请登录失败后恢复被暂停的进程卡调度', async () => {
  const filename = path.join(ACTIVITY_ROOT, 'detail/index.js');
  const source = fs.readFileSync(filename, 'utf8');
  const nativeRequire = createRequire(filename);
  const timers = new Map();
  let timerId = 0;
  let definition;
  vm.runInNewContext(source, {
    Page(value) { definition = value; },
    wx: { showShareMenu() {}, showToast() {}, navigateTo() {}, switchTab() {} },
    getCurrentPages: () => [{}],
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    require(name) {
      if (name.endsWith('services/activity')) return {};
      if (name.endsWith('services/user')) return { login: async () => { throw new Error('offline'); } };
      if (name.endsWith('services/direct-message')) return {};
      if (name.endsWith('services/progress-storage')) return {};
      return nativeRequire(name);
    }
  });
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); }
  };
  page._disposed = false;
  page._visible = true;
  page._loadSeq = 1;
  page._progressPending = { activityId: 'food-activity', stage: 'MEAL_REGISTERED', rank: 0 };
  page.data.activity = { id: 'food-activity', canApply: true };
  page.handleApplyOpen();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.data.showApply, false);
  assert.equal(timers.size, 1);
});
