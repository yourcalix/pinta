'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const communityService = require('../miniprogram/services/community');

function loadCommunityPage() {
  let definition;
  global.Page = (value) => { definition = value; };
  global.wx = {
    navigateTo() {},
    showToast() {},
    stopPullDownRefresh() {}
  };
  const pagePath = require.resolve('../miniprogram/pages/community/index');
  delete require.cache[pagePath];
  require(pagePath);
  return {
    pagePath,
    page: {
      ...definition,
      data: { ...definition.data },
      setData(value) { Object.assign(this.data, value); }
    }
  };
}

function unloadCommunityPage(context) {
  delete require.cache[context.pagePath];
  delete global.Page;
  delete global.wx;
}

test('社区页把昵称装饰为受控单字头像且不生成位图路径', async () => {
  const originalListPosts = communityService.listPosts;
  communityService.listPosts = async () => ({
    items: [{
      id: 'post-1',
      content: '周末一起交流新的运动项目。',
      createdAt: new Date().toISOString(),
      replyCount: 2,
      author: { nickname: '小满' }
    }],
    nextCursor: null
  });
  const context = loadCommunityPage();
  try {
    await context.page.loadPosts(false);
    const [post] = context.page.data.posts;
    assert.equal(post.avatarInitial, '小');
    assert.match(post.avatarTone, /^(blue|purple|orange|green|teal)$/);
    assert.equal(post.avatarPath, undefined);
    assert.match(post.accessibilityLabel, /小满发布的讨论/);
  } finally {
    communityService.listPosts = originalListPosts;
    unloadCommunityPage(context);
  }
});

test('社区续页失败保留已有帖子并只显示安全的局部重试状态', async () => {
  const originalListPosts = communityService.listPosts;
  communityService.listPosts = async () => { throw new Error('raw transport secret'); };
  const context = loadCommunityPage();
  try {
    context.page.setData({
      posts: [{ id: 'kept' }],
      nextCursor: 'opaque-next',
      hasMore: true,
      loading: false,
      loadingMore: false
    });
    await context.page.loadPosts(true);
    assert.deepEqual(context.page.data.posts, [{ id: 'kept' }]);
    assert.equal(context.page.data.loadMoreError, '加载更多失败，请重试');
    assert.equal(context.page.data.error, '');
    assert.doesNotMatch(JSON.stringify(context.page.data), /raw transport secret/);
  } finally {
    communityService.listPosts = originalListPosts;
    unloadCommunityPage(context);
  }
});
