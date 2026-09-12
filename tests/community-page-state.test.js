'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const communityService = require('../miniprogram/services/community');
const userService = require('../miniprogram/services/user');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function loadCommunityPage() {
  let definition;
  const toasts = [];
  const navigations = [];
  global.Page = (value) => { definition = value; };
  global.wx = {
    navigateTo(options) { navigations.push(options); },
    showToast(options) { toasts.push(options); },
    stopPullDownRefresh() {}
  };
  const pagePath = require.resolve('../miniprogram/pages/community/index');
  delete require.cache[pagePath];
  require(pagePath);
  return {
    pagePath,
    toasts,
    navigations,
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

test('社区搜索只在显式提交后生效且刷新分页始终使用已提交关键词', async () => {
  const originalListPosts = communityService.listPosts;
  const calls = [];
  communityService.listPosts = async (filters) => {
    calls.push({ ...filters });
    return { items: [], nextCursor: null };
  };
  const context = loadCommunityPage();
  try {
    context.page.setData({ loading: false });
    context.page.handleKeywordInput({ detail: { value: '  露营  ' } });
    assert.equal(context.page.data.keyword, '  露营  ');
    assert.equal(context.page.data.appliedKeyword, '');
    await context.page.handleSearchSubmit();
    assert.equal(context.page.data.keyword, '露营');
    assert.equal(context.page.data.appliedKeyword, '露营');
    assert.equal(calls.at(-1).keyword, '露营');

    context.page.handleKeywordInput({ detail: { value: '尚未提交' } });
    await context.page.loadPosts(false, true);
    assert.equal(calls.at(-1).keyword, '露营');

    await context.page.handleClearKeyword();
    assert.equal(context.page.data.keyword, '');
    assert.equal(context.page.data.appliedKeyword, '');
    assert.equal(calls.at(-1).keyword, undefined);
  } finally {
    communityService.listPosts = originalListPosts;
    unloadCommunityPage(context);
  }
});

test('键盘确认和搜索按钮的重复提交由现有loading状态收敛', async () => {
  const originalListPosts = communityService.listPosts;
  let resolveRequest;
  let calls = 0;
  communityService.listPosts = () => {
    calls += 1;
    return new Promise((resolve) => { resolveRequest = resolve; });
  };
  const context = loadCommunityPage();
  try {
    context.page.setData({ keyword: '运动', loading: false });
    const first = context.page.handleSearchSubmit();
    const second = context.page.handleSearchSubmit();
    assert.equal(second, undefined);
    assert.equal(calls, 1);
    resolveRequest({ items: [], nextCursor: null });
    await first;
  } finally {
    communityService.listPosts = originalListPosts;
    unloadCommunityPage(context);
  }
});

test('发现页点赞即时切换心形、独立防重并以服务端结果校准', async () => {
  const originalLogin = userService.login;
  const originalSetLike = communityService.setLike;
  const response = deferred();
  let calls = 0;
  userService.login = async () => ({ profileComplete: true });
  communityService.setLike = async (targetType, targetId, liked) => {
    calls += 1;
    assert.deepEqual([targetType, targetId, liked], ['post', 'post-1', true]);
    return response.promise;
  };
  const context = loadCommunityPage();
  try {
    context.page.setData({ posts: [{ id: 'post-1', authorNickname: '小满', content: '测试', timeLabel: '刚刚', replyCount: 0, likeCount: 2, viewerHasLiked: false, likePending: false }] });
    const event = { currentTarget: { dataset: { id: 'post-1' } } };
    const first = context.page.handlePostLike(event);
    const second = context.page.handlePostLike(event);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.equal(context.page.data.posts[0].viewerHasLiked, true);
    assert.equal(context.page.data.posts[0].likeCount, 3);
    assert.equal(context.page.data.posts[0].likePending, true);
    response.resolve({ liked: true, likeCount: 4 });
    await Promise.all([first, second]);
    assert.equal(context.page.data.posts[0].viewerHasLiked, true);
    assert.equal(context.page.data.posts[0].likeCount, 4);
    assert.equal(context.page.data.posts[0].likePending, false);
  } finally {
    userService.login = originalLogin;
    communityService.setLike = originalSetLike;
    unloadCommunityPage(context);
  }
});

test('发现页点赞失败精确回滚且资料不完整时不提前改变状态', async () => {
  const originalLogin = userService.login;
  const originalSetLike = communityService.setLike;
  userService.login = async () => ({ profileComplete: true });
  communityService.setLike = async () => { throw new Error('raw secret'); };
  const context = loadCommunityPage();
  try {
    const post = { id: 'post-1', authorNickname: '小满', content: '测试', timeLabel: '刚刚', replyCount: 1, likeCount: 2, viewerHasLiked: false, likePending: false };
    context.page.setData({ posts: [post] });
    await context.page.handlePostLike({ currentTarget: { dataset: { id: 'post-1' } } });
    assert.equal(context.page.data.posts[0].viewerHasLiked, false);
    assert.equal(context.page.data.posts[0].likeCount, 2);
    assert.equal(context.toasts.at(-1).title, '点赞失败，请重试');

    userService.login = async () => ({ profileComplete: false });
    await context.page.handlePostLike({ currentTarget: { dataset: { id: 'post-1' } } });
    assert.equal(context.page.data.posts[0].viewerHasLiked, false);
    assert.equal(context.page.data.posts[0].likeCount, 2);
    assert.equal(context.navigations.at(-1).url, '/subpackages/profile/edit/index');
  } finally {
    userService.login = originalLogin;
    communityService.setLike = originalSetLike;
    unloadCommunityPage(context);
  }
});

test('点赞在途时晚到的刷新快照不会让心形和计数闪回', async () => {
  const originalLogin = userService.login;
  const originalSetLike = communityService.setLike;
  const originalListPosts = communityService.listPosts;
  const listResponse = deferred();
  const likeResponse = deferred();
  userService.login = async () => ({ profileComplete: true });
  communityService.listPosts = () => listResponse.promise;
  communityService.setLike = () => likeResponse.promise;
  const context = loadCommunityPage();
  try {
    context.page.setData({ posts: [
      { id: 'post-1', authorNickname: '小满', content: '测试', timeLabel: '刚刚', replyCount: 0, likeCount: 2, viewerHasLiked: false, likePending: false },
      { id: 'post-2', authorNickname: '阿青', content: '其他帖子', timeLabel: '刚刚', replyCount: 0, likeCount: 1, viewerHasLiked: false, likePending: false }
    ], loading: false });
    const refresh = context.page.loadPosts(false, true);
    const like = context.page.handlePostLike({ currentTarget: { dataset: { id: 'post-1' } } });
    await new Promise((resolve) => setImmediate(resolve));
    listResponse.resolve({ items: [
      { id: 'post-1', author: { nickname: '小满' }, content: '测试', createdAt: new Date().toISOString(), replyCount: 0, likeCount: 2, viewerHasLiked: false },
      { id: 'post-2', author: { nickname: '阿青' }, content: '其他帖子', createdAt: new Date().toISOString(), replyCount: 0, likeCount: 7, viewerHasLiked: true }
    ], nextCursor: null });
    await refresh;
    assert.equal(context.page.data.posts[0].viewerHasLiked, true);
    assert.equal(context.page.data.posts[0].likeCount, 3);
    assert.equal(context.page.data.posts[1].viewerHasLiked, true);
    assert.equal(context.page.data.posts[1].likeCount, 7);
    likeResponse.resolve({ liked: true, likeCount: 4 });
    await like;
    assert.equal(context.page.data.posts[0].likeCount, 4);
  } finally {
    userService.login = originalLogin;
    communityService.setLike = originalSetLike;
    communityService.listPosts = originalListPosts;
    unloadCommunityPage(context);
  }
});

test('旧点赞请求失败时不会回滚重新进入列表的同 ID 帖子', async () => {
  const originalLogin = userService.login;
  const originalSetLike = communityService.setLike;
  const response = deferred();
  userService.login = async () => ({ profileComplete: true });
  communityService.setLike = () => response.promise;
  const context = loadCommunityPage();
  try {
    const base = { id: 'post-1', authorNickname: '小满', content: '测试', timeLabel: '刚刚', replyCount: 0, likeCount: 2, viewerHasLiked: false, likePending: false };
    context.page.setData({ posts: [base] });
    const request = context.page.handlePostLike({ currentTarget: { dataset: { id: 'post-1' } } });
    await new Promise((resolve) => setImmediate(resolve));
    context.page.setData({ posts: [] });
    context.page.setData({ posts: [{ ...base, likeCount: 8, viewerHasLiked: true }] });
    response.reject(new Error('late failure'));
    await request;
    assert.equal(context.page.data.posts[0].viewerHasLiked, true);
    assert.equal(context.page.data.posts[0].likeCount, 8);
    assert.equal(context.page.data.posts[0].likePending, false);
  } finally {
    userService.login = originalLogin;
    communityService.setLike = originalSetLike;
    unloadCommunityPage(context);
  }
});

test('旧点赞请求成功时不会覆盖重新进入列表的同 ID 帖子', async () => {
  const originalLogin = userService.login;
  const originalSetLike = communityService.setLike;
  const response = deferred();
  userService.login = async () => ({ profileComplete: true });
  communityService.setLike = () => response.promise;
  const context = loadCommunityPage();
  try {
    const base = { id: 'post-1', authorNickname: '小满', content: '测试', timeLabel: '刚刚', replyCount: 0, likeCount: 2, viewerHasLiked: false, likePending: false };
    context.page.setData({ posts: [base] });
    const request = context.page.handlePostLike({ currentTarget: { dataset: { id: 'post-1' } } });
    await new Promise((resolve) => setImmediate(resolve));
    context.page.setData({ posts: [{ ...base, likeCount: 8, viewerHasLiked: true }] });
    response.resolve({ liked: true, likeCount: 3 });
    await request;
    assert.equal(context.page.data.posts[0].viewerHasLiked, true);
    assert.equal(context.page.data.posts[0].likeCount, 8);
    assert.equal(context.page.data.posts[0].likePending, false);
  } finally {
    userService.login = originalLogin;
    communityService.setLike = originalSetLike;
    unloadCommunityPage(context);
  }
});
