'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../miniprogram/subpackages/profile/edit');
const PAGE_PATH = require.resolve('../miniprogram/subpackages/profile/edit/index');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

function applyPatch(data, patch) {
  for (const [key, value] of Object.entries(patch)) {
    const parts = key.split('.');
    let target = data;
    for (let index = 0; index < parts.length - 1; index += 1) target = target[parts[index]];
    target[parts[parts.length - 1]] = value;
  }
}

function loadPage() {
  let definition;
  const timers = [];
  const previousPage = global.Page;
  const previousWx = global.wx;
  const previousSetTimeout = global.setTimeout;
  const previousClearTimeout = global.clearTimeout;
  global.Page = (value) => { definition = value; };
  global.wx = { hideKeyboard() {} };
  global.setTimeout = (callback) => {
    const timer = { callback, cancelled: false };
    timers.push(timer);
    return timer;
  };
  global.clearTimeout = (timer) => { if (timer) timer.cancelled = true; };
  delete require.cache[PAGE_PATH];
  require(PAGE_PATH);
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch, callback) {
      applyPatch(this.data, patch);
      if (callback) callback();
    }
  };
  page.data.loading = false;
  return {
    page,
    flushTimers() {
      for (const timer of timers.splice(0)) if (!timer.cancelled) timer.callback();
    },
    cleanup() {
      delete require.cache[PAGE_PATH];
      if (previousPage) global.Page = previousPage; else delete global.Page;
      if (previousWx) global.wx = previousWx; else delete global.wx;
      global.setTimeout = previousSetTimeout;
      global.clearTimeout = previousClearTimeout;
    }
  };
}

test('昵称行显示当前值与箭头并打开独立底部抽屉', () => {
  const template = read('index.wxml');
  const style = read('index.wxss');

  assert.match(template, /class="profile-row nickname-row"[^>]*bindtap="handleNicknameOpen"/);
  assert.match(template, /\{\{form\.nickname \|\| '未填写'\}\}[\s\S]*class="row-chevron"/);
  assert.doesNotMatch(template, /data-field="nickname"[^>]*bindinput="handleInput"/);
  assert.match(template, /wx:if="\{\{nicknameSheetMounted\}\}"[^>]*class="nickname-dialog"/);
  assert.match(template, /catchtouchmove="preventScroll"/);
  assert.match(template, /role="dialog"[^>]*aria-modal="true"/);
  assert.match(template, /focus="\{\{nicknameInputFocus\}\}"[^>]*adjust-position="\{\{true\}\}"/);
  assert.match(template, /confirm-type="done"[^>]*bindinput="handleNicknameDraftInput"[^>]*bindconfirm="handleNicknameConfirm"/);
  assert.match(style, /\.nickname-dialog,\s*\.nickname-backdrop,\s*\.nickname-sheet\s*{[^}]*position:\s*fixed/);
  assert.match(style, /\.nickname-backdrop\s*{[^}]*z-index:\s*100/);
  assert.match(style, /\.nickname-sheet\s*{[\s\S]*z-index:\s*101[\s\S]*border-radius:\s*36rpx 36rpx 0 0/);
  assert.match(style, /@media \(prefers-reduced-motion:\s*reduce\)/);
});

test('昵称抽屉取消丢弃草稿，确定只回写本地表单昵称', () => {
  const context = loadPage();
  try {
    const { page } = context;
    page.data.form.nickname = '原昵称';
    page.handleNicknameOpen();
    assert.equal(page.data.nicknameSheetMounted, true);
    assert.equal(page.data.nicknameDraft, '原昵称');
    page.handleNicknameDraftInput({ detail: { value: '临时名字' } });
    assert.equal(page.data.form.nickname, '原昵称');
    page.handleNicknameClose();
    context.flushTimers();
    assert.equal(page.data.form.nickname, '原昵称');
    assert.equal(page.data.nicknameSheetMounted, false);

    page.handleNicknameOpen();
    page.handleNicknameDraftInput({ detail: { value: '  新昵称  ' } });
    page.handleNicknameConfirm();
    assert.equal(page.data.form.nickname, '新昵称');
    assert.equal(page.data.nicknameSheetOpen, false);
  } finally {
    context.cleanup();
  }
});

test('昵称草稿不足两个字时阻止确认并提供行内错误', () => {
  const context = loadPage();
  try {
    const { page } = context;
    page.data.form.nickname = '合法昵称';
    page.handleNicknameOpen();
    page.handleNicknameDraftInput({ detail: { value: '  一  ' } });
    assert.equal(page.data.nicknameCanConfirm, false);
    assert.match(page.data.nicknameError, /2/);
    page.handleNicknameConfirm();
    assert.equal(page.data.form.nickname, '合法昵称');
    assert.equal(page.data.nicknameSheetMounted, true);
  } finally {
    context.cleanup();
  }
});
