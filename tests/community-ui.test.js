'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('底部导航按发现、社区、发布、消息、我的排列', () => {
  const app = JSON.parse(read('app.json'));
  assert.deepEqual(app.tabBar.list.map((item) => item.text), ['发现', '社区', '发布', '消息', '我的']);
  assert.equal(app.tabBar.list[1].pagePath, 'pages/community/index');
});

test('社区首页按参考论坛骨架展示居中标题、社区提示、双快捷卡和最新讨论', () => {
  const template = read('pages/community/index.wxml');
  const style = read('pages/community/index.wxss');
  const pageConfig = JSON.parse(read('pages/community/index.json'));
  const markers = ['community-navigation', 'community-notice', 'community-shortcuts', 'discussion-tabs', 'post-list'];
  const positions = markers.map((marker) => template.indexOf(marker));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(template, /class="community-nav-title"[^>]*>拼吧社区</);
  assert.match(template, /class="community-notice"[\s\S]*bindtap="handleGuidelines"/);
  assert.match(template, /友善交流，共建安全拼单社区/);
  assert.match(template, /class="shortcut-card shortcut-card--compose"[\s\S]*bindtap="handleCompose"/);
  assert.match(template, /class="shortcut-card shortcut-card--rules"[\s\S]*bindtap="handleGuidelines"/);
  assert.match(template, /class="discussion-tab discussion-tab--active"[^>]*>最新讨论</);
  assert.match(template, /class="discussion-sort"[^>]*>按发布时间</);
  assert.match(template, /class="community-fixed-background"[^>]*community-ambient-bg\.jpg/);
  assert.doesNotMatch(template, /shared-paper-bg\.jpg|global-page-background-tint/);
  assert.doesNotMatch(template, /新回|我发|我回|我赞|热门话题|分配对象|联系墙墙/);
  assert.doesNotMatch(template, /class="[^"]*fab/);
  assert.match(style, /\.community-nav-inner\s*\{[^}]*height:\s*88rpx/s);
  assert.match(style, /\.community-notice\s*\{[^}]*min-height:\s*100rpx/s);
  assert.match(style, /\.shortcut-card\s*\{[^}]*min-height:\s*112rpx/s);
  assert.match(style, /\.discussion-tab--active::after\s*\{[^}]*width:\s*48rpx[^}]*height:\s*6rpx/s);
  assert.match(style, /\.post-card\s*\{[^}]*min-height:\s*220rpx/s);
  assert.match(style, /-webkit-line-clamp:\s*3/);
  assert.match(style, /word-break:\s*break-word/);
  assert.match(style, /overflow-wrap:\s*anywhere/);
  assert.match(style, /padding-bottom:\s*calc\([^;]*safe-area-inset-bottom/);
  assert.match(style, /\.community-fixed-background\s*\{[^}]*position:\s*fixed[^}]*width:\s*100vw[^}]*height:\s*100vh[^}]*pointer-events:\s*none[^}]*transform:\s*translateZ\(0\)/s);
  assert.match(style, /\.community-page\s*\{[^}]*background:\s*#eff4fa/i);
  assert.match(style, /\.community-nav-title\s*\{[^}]*color:\s*#0f172a/i);
  assert.match(style, /\.discussion-tab\s*\{[^}]*color:\s*#0f172a/i);
  assert.equal(pageConfig.navigationBarTextStyle, 'black');
  assert.equal(pageConfig.backgroundColor, '#EFF4FA');
});

test('社区柔焦背景为本地 Baseline JPEG 且不依赖 WebP', () => {
  const backgroundPath = path.join(root, 'assets/images/community/community-ambient-bg.jpg');
  const background = fs.readFileSync(backgroundPath);
  assert.deepEqual([...background.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  assert.ok(background.length < 120 * 1024);
  assert.doesNotMatch(read('pages/community/index.wxml'), /\.webp/);
});

test('社区空状态与帖子卡使用白色圆角卡、CSS 图标和受控单字头像', () => {
  const template = read('pages/community/index.wxml');
  const style = read('pages/community/index.wxss');
  const script = read('pages/community/index.js');
  assert.match(template, /class="empty-bubble"[\s\S]*aria-hidden="true"/);
  assert.match(template, /class="post-avatar post-avatar--\{\{item\.avatarTone\}\}"/);
  assert.match(template, /\{\{item\.avatarInitial\}\}/);
  assert.doesNotMatch(template, /class="post-avatar"[^>]*<image|avatarPath/);
  assert.match(style, /\.post-card\s*\{[^}]*background:\s*#fff/i);
  assert.match(style, /\.post-avatar\s*\{[^}]*width:\s*64rpx[^}]*height:\s*64rpx/s);
  assert.match(style, /\.post-metrics\s*\{[^}]*justify-content:\s*flex-end/s);
  assert.doesNotMatch(template, /围观|浏览量|#反诈提醒|<image[^>]*post/);
  assert.match(script, /AVATAR_TONES/);
  assert.match(script, /avatarInitial/);
  assert.match(script, /loadMoreError/);
  assert.match(script, /讨论加载失败，请检查网络/);
});

test('社区两处守则入口复用只读原生弹窗且不新增假路由', () => {
  const script = read('pages/community/index.js');
  assert.match(script, /handleGuidelines\(\)\s*\{/);
  assert.match(script, /wx\.showModal\(\{/);
  assert.match(script, /title:\s*'拼吧社区守则'/);
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
