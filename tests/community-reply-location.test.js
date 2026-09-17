'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '../miniprogram');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function applyPath(target, pathText, value) {
  const parts = String(pathText).replace(/\[(\d+)\]/g, '.$1').split('.');
  let cursor = target;
  parts.slice(0, -1).forEach((part) => { cursor = cursor[part]; });
  cursor[parts.at(-1)] = value;
}

function instantiate(community, wxOverrides = {}) {
  let definition;
  const source = read('subpackages/community/detail/index.js');
  const deferredTimers = [];
  const wx = {
    nextTick: (callback) => callback(),
    pageScrollTo: (options) => { if (options.success) options.success(); },
    createSelectorQuery: () => {
      let callback = null;
      return {
        in() { return this; },
        select() { return this; },
        boundingClientRect(next) { callback = next; return this; },
        exec() { if (callback) callback({ top: 240, height: 120 }); }
      };
    },
    showToast: () => {}, navigateTo: () => {}, navigateBack: () => {}, switchTab: () => {},
    ...wxOverrides
  };
  vm.runInNewContext(source, {
    Page: (value) => { definition = value; }, module: { exports: {} }, exports: {}, wx,
    getCurrentPages: () => [{}, {}], console,
    setTimeout: (callback, delay) => {
      if (delay <= 60) { callback(); return 1; }
      deferredTimers.push(callback);
      return deferredTimers.length + 1;
    },
    clearTimeout: () => {},
    require: (name) => {
      if (name.endsWith('/services/community')) return community;
      if (name.endsWith('/services/user')) return { login: async () => ({ profileComplete: true }) };
      if (name.endsWith('/services/safety')) return {};
      if (name.endsWith('/utils/community-report-reasons')) return { COMMUNITY_REPORT_REASONS: [] };
      if (name.endsWith('/utils/navigation-layout')) return { calculateContentTopInset: () => 88 };
      if (name.endsWith('/utils/passenger-avatar')) return {
        normalizeAvatarSlots: () => [{ src: '', mode: 'aspectFit', empty: true }], fallbackAvatarSlot: (slot) => slot
      };
      if (name.endsWith('/utils/open-community-author')) return { openCommunityAuthor: () => {} };
      throw new Error(`Unexpected require: ${name}`);
    }
  }, { filename: 'subpackages/community/detail/index.js' });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) };
  page.setData = (patch) => Object.entries(patch).forEach(([key, value]) => applyPath(page.data, key, value));
  return page;
}

const reply = (id, createdAt) => ({
  id, postId: 'post-1', author: { nickname: id }, content: `内容-${id}`,
  createdAt, updatedAt: createdAt, likeCount: 0, viewerHasLiked: false, viewerIsAuthor: false
});
const post = { id: 'post-1', author: { nickname: '作者' }, content: '正文', createdAt: '2026-09-17T01:00:00.000Z', replyCount: 21 };

async function flush(times = 30) {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

test('回复类动态跨页加载后滚动到安全索引锚点并消费已读', async () => {
  const calls = [];
  const reads = [];
  const scrolls = [];
  const firstPage = Array.from({ length: 20 }, (_, index) => reply(`reply-${index}`, `2026-09-17T01:${String(index).padStart(2, '0')}:00.000Z`));
  const community = {
    getPost: async (_postId, filters) => {
      calls.push(filters.cursor || 'FIRST');
      return filters.cursor
        ? { post, replies: [reply('reply-target', '2026-09-17T02:00:00.000Z')], nextCursor: null }
        : { post, replies: firstPage, nextCursor: 'cursor-2' };
    },
    readActivity: async (...args) => { reads.push(args); return { read: true, stale: false }; }
  };
  const page = instantiate(community, {
    pageScrollTo: (options) => { scrolls.push(options); if (options.success) options.success(); }
  });
  await page.onLoad({ id: 'post-1', replyId: 'reply-target', activityId: 'activity-1', activityUpdatedAt: '2026-09-17T02:00:00.000Z' });
  await flush();

  assert.deepEqual(calls, ['FIRST', 'cursor-2']);
  assert.equal(scrolls.length, 1);
  assert.equal(scrolls[0].selector, '#community-reply-20');
  assert.ok(scrolls[0].offsetTop < -88);
  assert.equal(page.data.locatedReplyId, 'reply-target');
  assert.deepEqual(reads, [['activity-1', '2026-09-17T02:00:00.000Z', 'post-1']]);
  assert.equal(page.data.replyInputFocus, false);
  assert.equal(page.data.replyTarget, null);
});

test('目标回复自然不可见时提示并消费，定位网络失败时保持未读', async () => {
  const missingReads = [];
  const missingToasts = [];
  const missing = instantiate({
    getPost: async () => ({ post, replies: [], nextCursor: null }),
    readActivity: async (...args) => { missingReads.push(args); return { read: true, stale: false }; }
  }, { showToast: ({ title }) => missingToasts.push(title) });
  await missing.onLoad({ id: 'post-1', replyId: 'missing', activityId: 'activity-missing', activityUpdatedAt: '2026-09-17T02:00:00.000Z' });
  await flush();
  assert.equal(missingToasts.at(-1), '该回复已删除或不可见');
  assert.equal(missingReads.length, 1);

  const failedReads = [];
  const failedToasts = [];
  let requestCount = 0;
  const failed = instantiate({
    getPost: async () => {
      requestCount += 1;
      if (requestCount === 1) return { post, replies: [reply('reply-1', '2026-09-17T01:00:00.000Z')], nextCursor: 'cursor-2' };
      throw new Error('offline');
    },
    readActivity: async (...args) => { failedReads.push(args); return { read: true, stale: false }; }
  }, { showToast: ({ title }) => failedToasts.push(title) });
  await failed.onLoad({ id: 'post-1', replyId: 'reply-target', activityId: 'activity-failed', activityUpdatedAt: '2026-09-17T02:00:00.000Z' });
  await flush();
  assert.equal(failedReads.length, 0);
  assert.equal(failedToasts.at(-1), '暂时无法定位该回复');
  assert.match(failed.data.loadMoreError, /加载失败/);
});

test('达到200条安全上限停止自动请求且保持未读', async () => {
  const reads = [];
  const toasts = [];
  let getPostCalls = 0;
  const page = instantiate({
    getPost: async () => { getPostCalls += 1; throw new Error('不应继续请求'); },
    readActivity: async (...args) => { reads.push(args); return { read: true, stale: false }; }
  }, { showToast: ({ title }) => toasts.push(title) });
  page._disposed = false;
  page._targetReplyId = 'reply-target';
  page._sourceActivity = { id: 'activity-1', updatedAt: '2026-09-17T02:00:00.000Z', postId: 'post-1', pending: false, done: false };
  page.data.post = post;
  page.data.replies = Array.from({ length: 200 }, (_, index) => reply(`reply-${index}`, `2026-09-17T01:00:${String(index % 60).padStart(2, '0')}.000Z`));
  page.data.hasMore = true;
  await page.startReplyLocating();

  assert.equal(getPostCalls, 0);
  assert.equal(reads.length, 0);
  assert.equal(toasts.at(-1), '回复较多，请继续加载查看');
});

test('页面隐藏会熔断在途自动分页且不滚动不消费', async () => {
  let resolveAppend;
  let requestCount = 0;
  const reads = [];
  const scrolls = [];
  const community = {
    getPost: async () => {
      requestCount += 1;
      if (requestCount === 1) return { post, replies: [reply('reply-1', '2026-09-17T01:00:00.000Z')], nextCursor: 'cursor-2' };
      return new Promise((resolve) => { resolveAppend = resolve; });
    },
    readActivity: async (...args) => { reads.push(args); return { read: true, stale: false }; }
  };
  const page = instantiate(community, { pageScrollTo: (options) => scrolls.push(options) });
  const loading = page.onLoad({ id: 'post-1', replyId: 'reply-target', activityId: 'activity-1', activityUpdatedAt: '2026-09-17T02:00:00.000Z' });
  await flush();
  assert.equal(typeof resolveAppend, 'function');
  page.onHide();
  assert.equal(page.data.loadingMore, false);
  resolveAppend({ post, replies: [reply('reply-target', '2026-09-17T02:00:00.000Z')], nextCursor: null });
  await loading;
  await flush();
  assert.equal(scrolls.length, 0);
  assert.equal(reads.length, 0);
});

test('首屏请求期间切到后台会作废旧响应并在回到前台后重新加载', async () => {
  let resolveFirst;
  let requestCount = 0;
  const community = {
    getPost: async () => {
      requestCount += 1;
      if (requestCount === 1) return new Promise((resolve) => { resolveFirst = resolve; });
      return { post, replies: [reply('reply-1', '2026-09-17T01:00:00.000Z')], nextCursor: null };
    },
    readActivity: async () => ({ read: true, stale: false })
  };
  const page = instantiate(community);
  const firstLoad = page.onLoad({ id: 'post-1' });
  await flush();
  page.onHide();
  resolveFirst({ post, replies: [], nextCursor: null });
  await firstLoad;
  assert.equal(page.data.post, null);

  page.onShow();
  await flush();
  assert.equal(requestCount, 2);
  assert.equal(page.data.post.id, 'post-1');
  assert.equal(page.data.replies[0].id, 'reply-1');
});

test('详情模板使用安全索引锚点且高亮只改变背景色', () => {
  const template = read('subpackages/community/detail/index.wxml');
  const style = read('subpackages/community/detail/index.wxss');
  assert.match(template, /id="community-reply-\{\{index\}\}"/);
  assert.match(template, /item\.id === locatedReplyId \? 'reply-card--located'/);
  assert.match(style, /\.reply-card--located\s*{[^}]*background-color:/s);
  const locatedRule = style.match(/\.reply-card--located\s*{([^}]*)}/s);
  assert.ok(locatedRule);
  assert.doesNotMatch(locatedRule[1], /(?:padding|margin|border-width|transform)\s*:/);
});
