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

test('发现页采用真实讨论搜索、通知入口、真实主题动作和社区帖子流', () => {
  const template = read('pages/community/index.wxml');
  const style = read('pages/community/index.wxss');
  const script = read('pages/community/index.js');
  const config = JSON.parse(read('pages/community/index.json'));
  const markers = ['community-reference-header', 'community-topic-rail', 'post-list'];
  const positions = markers.map((marker) => template.indexOf(marker));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(template, /class="discussion-search-input"[^>]*placeholder="搜索讨论内容…"[^>]*bindinput="handleKeywordInput"[^>]*bindconfirm="handleSearchSubmit"/);
  assert.match(template, /class="discussion-search-clear"[^>]*bindtap="handleClearKeyword"/);
  assert.match(template, /class="discussion-search-action"[^>]*bindtap="handleSearchSubmit"[^>]*>搜索/);
  assert.match(template, /class="search-result-bar"[^>]*\{\{appliedKeyword\}\}/);
  assert.match(template, /class="community-notification"[^>]*bindtap="handleMessages"/);
  assert.match(template, /class="community-topic-rail"[^>]*enable-flex="true"/);
  assert.match(template, /data-action="companion"[^>]*bindtap="handleTopicAction"/);
  assert.match(template, /data-action="guidelines"[^>]*bindtap="handleTopicAction"/);
  assert.match(template, /data-action="compose"[^>]*bindtap="handleTopicAction"/);
  assert.match(template, /#寻找搭子|#社区守则|#发布讨论/);
  assert.match(script, /handleCompanionOrbit\(\)/);
  assert.match(script, /handleSearchSubmit\(\)/);
  assert.match(script, /keyword:\s*this\.data\.appliedKeyword \|\| undefined/);
  assert.match(script, /handleMessages\(\)/);
  assert.match(script, /handleTopicAction\(event\)/);
  assert.doesNotMatch(template, /discussion-tabs|精选推荐|关注|附近|问答/);
  assert.doesNotMatch(template, /community-fixed-background|community-shortcuts|新回|我发|我回|我赞/);
  assert.match(style, /\.community-page\s*\{[^}]*background:\s*#f9f7f2/s);
  assert.match(style, /\.discussion-search-entry\s*\{[^}]*min-height:\s*88rpx/s);
  assert.match(style, /\.discussion-search-action\s*\{[^}]*min-height:\s*88rpx/s);
  assert.match(style, /\.community-notification\s*\{[^}]*min-width:\s*88rpx/s);
  assert.match(style, /\.topic-card\s*\{[^}]*width:\s*210rpx/s);
  assert.match(style, /\.topic-card\s*\{[^}]*flex-shrink:\s*0/s);
  assert.match(style, /\.post-card\s*\{[^}]*border-radius:\s*28rpx/s);
  assert.match(style, /-webkit-line-clamp:\s*4/);
  assert.match(style, /overflow-wrap:\s*anywhere/);
  assert.match(style, /word-break:\s*break-all/);
  assert.match(template, /hover-class="post-card-hover"[^>]*hover-start-time="60"[^>]*hover-stay-time="70"/);
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
  assert.doesNotMatch(template, /post-detail-link|查看详情/);
  assert.match(template, /class="like-count reply-count"[^>]*data-r="1"[^>]*catchtap="handlePost"/);
  assert.match(template, /community-empty-discussion\.png/);
  assert.doesNotMatch(template, /认证邻居|关联活动|收藏|分享|帖子图片|post-image|围观|浏览量|#反诈提醒/);
  assert.match(script, /AVATAR_TONES/);
  assert.match(script, /avatarInitial/);
  assert.match(script, /loadMoreError/);
  assert.match(script, /发现内容加载失败/);
});

test('发现页帖子心形是独立点赞操作并以形状和文案表达状态', () => {
  const template = read('pages/community/index.wxml');
  const style = read('pages/community/index.wxss');
  const script = read('pages/community/index.js');
  assert.match(template, /class="like-count[^\"]*\{\{item\.viewerHasLiked \? 'like-count--active' : ''\}\}"/);
  assert.match(template, /catchtap="handlePostLike"/);
  assert.doesNotMatch(template, /\sdisabled="\{\{item\.likePending\}\}"/);
  assert.match(template, /\{\{item\.viewerHasLiked \? '♥' : '♡'\}\}/);
  assert.match(template, /aria-label="\{\{item\.viewerHasLiked[^\"]*当前\{\{item\.likeCount\}\}个赞"/);
  assert.match(script, /communityService\.setLike\('post', postId, liked\)/);
  assert.match(style, /\.like-count\s*\{[^}]*min-width:\s*88rpx[^}]*min-height:\s*88rpx/s);
  assert.match(style, /\.like-count--active\s+\.like-symbol\s*\{[^}]*color:\s*#e2554f/s);
});

test('发现主题动作复用既有守则、发帖、在线星球与消息路由', () => {
  const script = read('pages/community/index.js');
  assert.match(script, /handleGuidelines\(\)\s*\{/);
  assert.match(script, /wx\.showModal\(\{/);
  assert.match(script, /title:\s*'拼吧发现守则'/);
  assert.match(script, /showCancel:\s*false/);
  assert.match(script, /subpackages\/community\/companion\/index/);
  assert.match(script, /pages\/messages\/index/);
  assert.match(script, /subpackages\/community\/compose\/index/);
  assert.doesNotMatch(script, /pages\/common\/webview|community\/rules/);
});

test('发现讨论搜索具备提交态、清空、空态、失败和分页语义', () => {
  const template = read('pages/community/index.wxml');
  const script = read('pages/community/index.js');
  const style = read('pages/community/index.wxss');
  assert.match(script, /keyword:\s*''/);
  assert.match(script, /appliedKeyword:\s*''/);
  assert.match(script, /handleKeywordInput\(event\)/);
  assert.match(script, /handleClearKeyword\(\)/);
  assert.match(script, /handleResetSearch\(\)/);
  assert.match(template, /没有找到相关讨论/);
  assert.match(template, /搜索暂时走丢了/);
  assert.match(template, /重新搜索/);
  assert.match(template, /还在查找更多讨论/);
  assert.match(template, /bindtap="handleRetryLoadMore"[^>]*>继续查找/);
  assert.match(template, /已显示全部相关讨论/);
  assert.match(style, /@media \(max-width:\s*340px\)[\s\S]*\.discussion-search-entry\s*\{[^}]*padding:\s*0 16rpx/s);
});

test('发现页新增 Image2 素材为本地透明 PNG 且总量不突破 90KB', () => {
  const assets = [
    'assets/images/community/community-topic-companion.png',
    'assets/images/community/community-topic-guidelines.png',
    'assets/images/community/community-topic-compose.png',
    'assets/images/community/community-notification-bell.png',
    'assets/images/community/community-empty-discussion.png'
  ];
  let total = 0;
  assets.forEach((relativePath) => {
    const absolutePath = path.join(root, relativePath);
    assert.equal(fs.existsSync(absolutePath), true, relativePath);
    const bytes = fs.readFileSync(absolutePath);
    assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG');
    total += bytes.length;
  });
  assert.ok(total <= 90 * 1024, `community assets use ${total} bytes`);
});

test('社区详情回复栏具备键盘与安全区避让，装饰头像退出无障碍树', () => {
  const template = read('subpackages/community/detail/index.wxml');
  const style = read('subpackages/community/detail/index.wxss');
  assert.match(template, /cursor-spacing="120"/);
  assert.match(template, /adjust-position="true"/);
  assert.match(template, /focus="\{\{replyInputFocus\}\}"/);
  assert.match(template, /bindblur="handleReplyBlur"/);
  assert.match(template, /aria-hidden="true"/);
  assert.match(style, /env\(safe-area-inset-bottom\)/);
});
