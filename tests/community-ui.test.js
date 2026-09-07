'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('底部导航按首页、发现、发布、消息、我的排列且路由不迁移', () => {
  const app = JSON.parse(read('app.json'));
  assert.deepEqual(app.tabBar.list.map((item) => item.text), ['首页', '发现', '发布', '消息', '我的']);
  assert.equal(app.tabBar.list[0].pagePath, 'pages/discover/index');
  assert.equal(app.tabBar.list[1].pagePath, 'pages/community/index');
});

test('发现页采用标题、发帖入口、守则公告、栏目标题和真实帖子流', () => {
  const template = read('pages/community/index.wxml');
  const style = read('pages/community/index.wxss');
  const config = JSON.parse(read('pages/community/index.json'));
  const markers = ['discover-square-header', 'community-notice', 'discussion-tabs', 'post-list'];
  const positions = markers.map((marker) => template.indexOf(marker));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(template, /PINBA DISCOVER/);
  assert.match(template, /class="discover-square-title"[^>]*>发现</);
  assert.match(template, /class="discover-compose-button"[^>]*bindtap="handleCompose"/);
  assert.match(template, /class="community-notice"[^>]*bindtap="handleGuidelines"/);
  assert.match(template, /class="discussion-tab discussion-tab--active"[^>]*>正在发生</);
  assert.doesNotMatch(template, /community-fixed-background|community-shortcuts|新回|我发|我回|我赞/);
  assert.match(style, /\.community-page\s*\{[^}]*background:\s*#f9f7f2/s);
  assert.match(style, /\.discover-compose-button\s*\{[^}]*min-height:\s*88rpx/s);
  assert.match(style, /\.community-notice\s*\{[^}]*min-height:\s*100rpx/s);
  assert.match(style, /\.post-card\s*\{[^}]*min-height:\s*230rpx/s);
  assert.match(style, /-webkit-line-clamp:\s*3/);
  assert.match(style, /overflow-wrap:\s*anywhere/);
  assert.equal(config.navigationBarTextStyle, 'black');
  assert.equal(config.backgroundColor, '#F9F7F2');
});

test('发现页空状态与帖子卡使用白卡、受控单字头像和真实互动数', () => {
  const template = read('pages/community/index.wxml');
  const style = read('pages/community/index.wxss');
  const script = read('pages/community/index.js');
  assert.match(template, /class="empty-bubble"[^>]*aria-hidden="true"/);
  assert.match(template, /class="post-avatar post-avatar--\{\{item\.avatarTone\}\}"/);
  assert.match(template, /\{\{item\.avatarInitial\}\}/);
  assert.match(template, /\{\{item\.likeCount\}\}/);
  assert.match(template, /\{\{item\.replyCount\}\}/);
  assert.match(style, /\.post-card,\.skeleton-card,\.empty-card\s*\{[^}]*background:\s*#fff/s);
  assert.doesNotMatch(template, /围观|浏览量|#反诈提醒|<image[^>]*post/);
  assert.match(script, /AVATAR_TONES/);
  assert.match(script, /avatarInitial/);
  assert.match(script, /loadMoreError/);
  assert.match(script, /发现内容加载失败/);
});

test('发现守则复用只读原生弹窗且不新增假路由', () => {
  const script = read('pages/community/index.js');
  assert.match(script, /handleGuidelines\(\)\s*\{/);
  assert.match(script, /wx\.showModal\(\{/);
  assert.match(script, /title:\s*'拼吧发现守则'/);
  assert.match(script, /showCancel:\s*false/);
  assert.doesNotMatch(script, /pages\/common\/webview|community\/rules/);
});

test('社区详情回复栏具备键盘与安全区避让，装饰头像退出无障碍树', () => {
  const template = read('subpackages/community/detail/index.wxml');
  const style = read('subpackages/community/detail/index.wxss');
  assert.match(template, /cursor-spacing="120"/);
  assert.match(template, /adjust-position="true"/);
  assert.match(template, /aria-hidden="true"/);
  assert.match(style, /env\(safe-area-inset-bottom\)/);
});
