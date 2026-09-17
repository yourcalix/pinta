'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../miniprogram');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function instantiate(relative, services = {}, wxOverrides = {}) {
  let definition;
  const source = read(relative);
  const module = { exports: {} };
  const wx = {
    navigateTo: () => {}, showToast: () => {}, navigateBack: () => {}, switchTab: () => {},
    ...wxOverrides
  };
  vm.runInNewContext(source, {
    Page: (value) => { definition = value; }, module, exports: module.exports, wx,
    getCurrentPages: () => [{}, {}], console, setTimeout, clearTimeout,
    require: (name) => {
      if (name.endsWith('/services/community')) return services.community || {};
      if (name.endsWith('/services/user')) return services.user || { login: async () => ({ profileComplete: true }) };
      if (name.endsWith('/services/safety')) return services.safety || {};
      if (name.endsWith('/utils/community-report-reasons')) return { COMMUNITY_REPORT_REASONS: [] };
      if (name.endsWith('/utils/navigation-layout')) return { calculateContentTopInset: () => 88 };
      if (name.endsWith('/utils/passenger-avatar')) return {
        normalizeAvatarSlots: () => [{ src: '', mode: 'aspectFit', empty: true }], fallbackAvatarSlot: (slot) => slot
      };
      if (name.endsWith('/utils/open-community-author')) return { openCommunityAuthor: () => {} };
      throw new Error(`Unexpected require: ${name}`);
    }
  }, { filename: relative });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) };
  page.setData = (patch) => Object.assign(page.data, patch);
  return page;
}

test('发现页铃铛展示服务端未读数量并在失败时保留快照', () => {
  const template = read('pages/community/index.wxml');
  const style = read('pages/community/index.wxss');
  const script = read('pages/community/index.js');
  assert.match(template, /activityUnreadTotal > 0/);
  assert.match(template, /community-notification-badge/);
  assert.match(template, /\{\{activityUnreadLabel\}\}/);
  assert.match(template, /aria-label="\{\{activityUnreadAriaLabel\}\}"/);
  assert.match(style, /\.community-notification\s*\{[^}]*position:relative[^}]*width:88rpx[^}]*height:88rpx/s);
  assert.match(style, /\.community-notification-badge\s*\{[^}]*pointer-events:none/s);
  assert.match(script, /communityService\.getActivityUnread\(\)/);
  assert.match(script, /count\s*>\s*99\s*\?\s*'99\+'/);
  assert.doesNotMatch(script, /catch \(error\)\s*\{[^}]*activityUnreadTotal:\s*0/s);
});

test('消息页讨论入口复用权威未读汇总而非首屏列表推算', () => {
  const script = read('pages/messages/index.js');
  assert.match(script, /communityService\.getActivityUnread\(\)/);
  assert.match(script, /discussionHasUnread = Number\(discussionResult\.value\.total\) > 0/);
  assert.doesNotMatch(script, /communityService\.listActivities\(\{ tab: 'ALL'/);
});

test('讨论动态筛选项展示等宽未读徽标并由权威汇总刷新', () => {
  const template = read('subpackages/community/activity/index.wxml');
  const style = read('subpackages/community/activity/index.wxss');
  const script = read('subpackages/community/activity/index.js');
  assert.match(template, /item\.unread > 0/);
  assert.match(template, /activity-tab-badge/);
  assert.match(template, /aria-label="\{\{item\.accessibilityLabel\}\}"/);
  assert.match(style, /\.activity-tab\s*\{[^}]*flex:1[^}]*min-width:0/s);
  assert.match(style, /\.activity-tab-badge\s*\{[^}]*flex:0 0 auto[^}]*font-variant-numeric:tabular-nums/s);
  assert.match(script, /communityService\.getActivityUnread\(\)/);
  assert.match(script, /REPLIES:\s*readCount\('REPLIES'\)/);
  assert.match(script, /LIKES:\s*readCount\('LIKES'\)/);
  assert.match(script, /onShow\(\)[\s\S]*loadActivities\(false, true\)/);
});

test('讨论动态从详情返回时保留现有列表，权威快照到达后再替换', async () => {
  let resolveList;
  const page = instantiate('subpackages/community/activity/index.js', {
    community: {
      listActivities: () => new Promise((resolve) => { resolveList = resolve; })
    }
  });
  page._disposed = false;
  page.data.loading = false;
  page.data.items = [{ id: 'activity-1', read: false, actorName: '旧动态' }];

  const request = page.loadActivities(false, true);
  assert.deepEqual(page.data.items, [{ id: 'activity-1', read: false, actorName: '旧动态' }]);
  assert.equal(page.data.loading, false);
  for (let index = 0; index < 4 && !resolveList; index += 1) await Promise.resolve();

  resolveList({
    items: [{
      id: 'activity-1', type: 'POST_REPLIED', postId: 'post-1', read: true,
      actors: [{ nickname: '小树' }], updatedAt: '2026-09-17T01:00:00.000Z'
    }],
    nextCursor: null
  });
  await request;
  assert.equal(page.data.items.length, 1);
  assert.equal(page.data.items[0].read, true);
  assert.equal(page.data.loading, false);
});

test('讨论动态静默刷新失败时保留现有列表', async () => {
  const page = instantiate('subpackages/community/activity/index.js', {
    community: { listActivities: async () => { throw new Error('offline'); } }
  });
  page._disposed = false;
  page.data.loading = false;
  page.data.items = [{ id: 'activity-1', read: false }];

  await page.loadActivities(false, true);
  assert.deepEqual(page.data.items, [{ id: 'activity-1', read: false }]);
  assert.equal(page.data.loading, false);
  assert.equal(page.data.error, '');
});

test('讨论动态刷新在登录等待前固定筛选快照', async () => {
  let releaseLogin;
  const filters = [];
  const page = instantiate('subpackages/community/activity/index.js', {
    user: { login: () => new Promise((resolve) => { releaseLogin = resolve; }) },
    community: {
      listActivities: async (input) => {
        filters.push(input);
        return { items: [], nextCursor: null };
      }
    }
  });
  page._disposed = false;
  page.data.currentTab = 'ALL';

  const request = page.loadActivities(false, true);
  page.data.currentTab = 'LIKES';
  releaseLogin({ profileComplete: true });
  await request;

  assert.equal(filters.length, 1);
  assert.equal(filters[0].tab, 'ALL');
});

test('动态卡片不再提前已读，详情成功后才按版本消费', () => {
  const activityScript = read('subpackages/community/activity/index.js');
  const detailScript = read('subpackages/community/detail/index.js');
  const handler = activityScript.slice(activityScript.indexOf('async handleActivity'), activityScript.indexOf('handleEmptyAction'));
  const regularNavigation = handler.slice(handler.indexOf("if (item.postId"));
  assert.doesNotMatch(regularNavigation, /readActivity/);
  assert.match(regularNavigation, /activityId=/);
  assert.match(regularNavigation, /activityUpdatedAt=/);
  assert.match(handler, /if \(item\.removed\)[\s\S]*readActivity\(id, item\.updatedAt, item\.postId\)/);
  assert.match(detailScript, /if \(this\._targetReplyId\) this\.startReplyLocating\(\);\s*else this\.consumeSourceActivity\(\)/);
  assert.match(detailScript, /this\._replyLocateSettled = true;[\s\S]*await this\.consumeSourceActivity\(\)/);
  assert.match(detailScript, /readActivity\(source\.id, source\.updatedAt, source\.postId\)/);
  assert.match(detailScript, /source\.done \|\| source\.pending/);
  assert.match(detailScript, /result\.read === true \|\| result\.stale === true/);
});

test('动态卡片运行时只导航，失效卡片确认后才消费', async () => {
  const reads = [];
  const routes = [];
  const toasts = [];
  const page = instantiate('subpackages/community/activity/index.js', {
    community: { readActivity: async (...args) => { reads.push(args); return { read: true, stale: false }; } }
  }, {
    navigateTo: (options) => routes.push(options.url),
    showToast: (options) => toasts.push(options.title)
  });
  page._disposed = false;
  page.data.items = [{ id: 'activity-1', postId: 'post-1', replyId: 'reply-1', updatedAt: '2026-09-15T01:00:00.000Z', read: false, removed: false }];
  await page.handleActivity({ currentTarget: { dataset: { id: 'activity-1' } } });
  assert.equal(reads.length, 0);
  assert.match(routes[0], /id=post-1&activityId=activity-1&activityUpdatedAt=/);
  assert.match(routes[0], /replyId=reply-1/);

  page._navigationPending = false;
  page.data.items = [{ id: 'activity-2', postId: 'post-2', updatedAt: '2026-09-15T02:00:00.000Z', read: false, removed: true }];
  page.refreshUnreadSummary = () => {};
  await page.handleActivity({ currentTarget: { dataset: { id: 'activity-2' } } });
  assert.deepEqual(reads[0], ['activity-2', '2026-09-15T02:00:00.000Z', 'post-2']);
  assert.equal(page.data.items[0].read, true);
  assert.equal(toasts.at(-1), '该内容已被删除或下架');

  const stalePage = instantiate('subpackages/community/activity/index.js', {
    community: { readActivity: async () => ({ read: false, stale: true }) }
  }, { showToast: () => {} });
  stalePage._disposed = false;
  stalePage.data.items = [{ id: 'activity-stale', postId: 'post-2', updatedAt: '2026-09-15T03:00:00.000Z', read: false, removed: true }];
  let staleSummaryRefreshes = 0;
  stalePage.refreshUnreadSummary = () => { staleSummaryRefreshes += 1; };
  await stalePage.handleActivity({ currentTarget: { dataset: { id: 'activity-stale' } } });
  assert.equal(stalePage.data.items[0].read, false);
  assert.equal(staleSummaryRefreshes, 1);
});

test('帖子详情首屏成功后消费一次，失败时不消费', async () => {
  const reads = [];
  const community = {
    getPost: async () => ({
      post: { id: 'post-1', author: { nickname: '作者' }, content: '正文', createdAt: '2026-09-15T01:00:00.000Z' },
      replies: [], nextCursor: null
    }),
    readActivity: async (...args) => { reads.push(args); return { read: true, stale: false }; }
  };
  const page = instantiate('subpackages/community/detail/index.js', { community });
  await page.onLoad({ id: 'post-1', activityId: 'activity-1', activityUpdatedAt: '2026-09-15T01:00:00.000Z' });
  await Promise.resolve();
  assert.deepEqual(reads, [['activity-1', '2026-09-15T01:00:00.000Z', 'post-1']]);
  await page.consumeSourceActivity();
  assert.equal(reads.length, 1);

  const failedReads = [];
  const failed = instantiate('subpackages/community/detail/index.js', {
    community: {
      getPost: async () => { const error = new Error('missing'); error.code = 'NOT_FOUND'; throw error; },
      readActivity: async (...args) => failedReads.push(args)
    }
  });
  await failed.onLoad({ id: 'post-2', activityId: 'activity-2', activityUpdatedAt: '2026-09-15T02:00:00.000Z' });
  assert.equal(failedReads.length, 0);
  assert.match(failed.data.error, /删除或不存在/);
});
