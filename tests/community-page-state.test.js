'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const communityService = require('../miniprogram/services/community');
const userService = require('../miniprogram/services/user');
const safetyService = require('../miniprogram/services/safety');

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

test('社区页优先装饰对应账号头像且无效DTO回退受控单字头像', async () => {
  const originalListPosts = communityService.listPosts;
  communityService.listPosts = async () => ({
    items: [{
      id: 'post-1',
      content: '周末一起交流新的运动项目。',
      createdAt: new Date().toISOString(),
      replyCount: 2,
      author: { nickname: '小满', avatar: { kind: 'CUSTOM', src: 'https://cdn.example/xiaoman.jpg', fallback: 'FEMALE_DEFAULT' } }
    }],
    nextCursor: null
  });
  const context = loadCommunityPage();
  try {
    await context.page.loadPosts(false);
    const [post] = context.page.data.posts;
    assert.equal(post.avatarInitial, '小');
    assert.match(post.avatarTone, /^(blue|purple|orange|green|teal)$/);
    assert.equal(post.avatarSlot.kind, 'CUSTOM');
    assert.equal(post.avatarSlot.src, 'https://cdn.example/xiaoman.jpg');
    assert.match(post.avatarSlot.fallbackSrc, /profile-avatar-female-painted\.png$/);
    assert.match(post.accessibilityLabel, /小满发布的讨论/);

    context.page.handlePostAvatarError({ currentTarget: { dataset: { id: 'post-1' } } });
    assert.equal(context.page.data.posts[0].avatarSlot.kind, 'DEFAULT');
    assert.equal(context.page.data.posts[0].avatarSlot.src, post.avatarSlot.fallbackSrc);
    context.page.handlePostAvatarError({ currentTarget: { dataset: { id: 'post-1' } } });
    assert.equal(context.page.data.posts[0].avatarSlot.empty, true);
    assert.equal(context.page.data.posts[0].avatarSlot.src, '');
  } finally {
    communityService.listPosts = originalListPosts;
    unloadCommunityPage(context);
  }
});

test('帖子普通点击与评论点击分别进入普通详情和自动回复详情', () => {
  const context = loadCommunityPage();
  try {
    context.page.handlePost({ currentTarget: { dataset: { id: 'post/1' } } });
    context.page.handlePost({ currentTarget: { dataset: { id: 'post/1', r: '1' } } });
    context.page.handlePost({ currentTarget: { dataset: { id: 'post/2', r: 'true' } } });
    context.page.handlePost({ currentTarget: { dataset: { id: '   ', r: '1' } } });
    context.page.handlePost({ currentTarget: { dataset: {} } });
    assert.deepEqual(context.navigations.map((item) => item.url), [
      '/subpackages/community/detail/index?id=post%2F1',
      '/subpackages/community/detail/index?id=post%2F1&reply=1',
      '/subpackages/community/detail/index?id=post%2F2'
    ]);
  } finally {
    unloadCommunityPage(context);
  }
});

test('作者菜单二次确认后删除帖子且同一目标操作防重', async () => {
  const originalDeletePost = communityService.deletePost;
  const deletion = deferred();
  let deleteCalls = 0;
  communityService.deletePost = async (postId) => {
    deleteCalls += 1;
    assert.equal(postId, 'post-1');
    return deletion.promise;
  };
  const context = loadCommunityPage();
  global.wx.showActionSheet = ({ itemList, itemColor, success }) => {
    assert.deepEqual(itemList, ['删除内容', '举报']);
    assert.equal(itemColor, undefined);
    success({ tapIndex: 0 });
  };
  global.wx.showModal = ({ title, success }) => {
    assert.equal(title, '确认删除');
    success({ confirm: true });
  };
  try {
    context.page.setData({ posts: [{ id: 'post-1', viewerIsAuthor: true }, { id: 'post-2', viewerIsAuthor: false }] });
    const event = { currentTarget: { dataset: { id: 'post-1' } } };
    const first = context.page.handlePostAction(event);
    const second = context.page.handlePostAction(event);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(deleteCalls, 1);
    deletion.resolve({ deleted: true });
    await Promise.all([first, second]);
    assert.deepEqual(context.page.data.posts.map((item) => item.id), ['post-2']);
    assert.equal(context.toasts.at(-1).title, '已删除');
  } finally {
    communityService.deletePost = originalDeletePost;
    unloadCommunityPage(context);
  }
});

test('作者取消删除时不调用接口且保留帖子', async () => {
  const originalDeletePost = communityService.deletePost;
  let deleteCalls = 0;
  communityService.deletePost = async () => { deleteCalls += 1; };
  const context = loadCommunityPage();
  global.wx.showActionSheet = ({ success }) => success({ tapIndex: 0 });
  global.wx.showModal = ({ success }) => success({ confirm: false });
  try {
    context.page.setData({ posts: [{ id: 'post-1', viewerIsAuthor: true }] });
    await context.page.handlePostAction({ currentTarget: { dataset: { id: 'post-1' } } });
    assert.equal(deleteCalls, 0);
    assert.equal(context.page.data.posts.length, 1);
  } finally {
    communityService.deletePost = originalDeletePost;
    unloadCommunityPage(context);
  }
});

test('非作者通过资料门禁后选择举报原因并提交', async () => {
  const originalLogin = userService.login;
  const originalReport = safetyService.report;
  const reports = [];
  userService.login = async () => ({ profileComplete: true });
  safetyService.report = async (payload) => { reports.push(payload); return { ok: true }; };
  const context = loadCommunityPage();
  let actionSheetCalls = 0;
  global.wx.showActionSheet = ({ itemList, success }) => {
    actionSheetCalls += 1;
    if (actionSheetCalls === 1) {
      assert.deepEqual(itemList, ['举报']);
      success({ tapIndex: 0 });
      return;
    }
    assert.deepEqual(itemList, ['虚假或误导信息', '诈骗或广告导流', '骚扰或不当内容', '其他问题']);
    success({ tapIndex: 2 });
  };
  try {
    context.page.setData({ posts: [{ id: 'post-1', viewerIsAuthor: false }] });
    await context.page.handlePostAction({ currentTarget: { dataset: { id: 'post-1' } } });
    assert.deepEqual(reports, [{ targetType: 'communityPost', targetId: 'post-1', reason: 'HARASSMENT', description: '' }]);
    assert.equal(context.toasts.at(-1).title, '已收到举报');
  } finally {
    userService.login = originalLogin;
    safetyService.report = originalReport;
    unloadCommunityPage(context);
  }
});

test('作者菜单也可选择举报并提交标准原因', async () => {
  const originalLogin = userService.login;
  const originalReport = safetyService.report;
  const reports = [];
  userService.login = async () => ({ profileComplete: true });
  safetyService.report = async (payload) => { reports.push(payload); return { ok: true }; };
  const context = loadCommunityPage();
  let actionSheetCalls = 0;
  global.wx.showActionSheet = ({ itemList, success }) => {
    actionSheetCalls += 1;
    if (actionSheetCalls === 1) {
      assert.deepEqual(itemList, ['删除内容', '举报']);
      success({ tapIndex: 1 });
      return;
    }
    assert.deepEqual(itemList, ['虚假或误导信息', '诈骗或广告导流', '骚扰或不当内容', '其他问题']);
    success({ tapIndex: 3 });
  };
  try {
    context.page.setData({ posts: [{ id: 'post-1', viewerIsAuthor: true }] });
    await context.page.handlePostAction({ currentTarget: { dataset: { id: 'post-1' } } });
    assert.deepEqual(reports, [{ targetType: 'communityPost', targetId: 'post-1', reason: 'OTHER', description: '' }]);
  } finally {
    userService.login = originalLogin;
    safetyService.report = originalReport;
    unloadCommunityPage(context);
  }
});

test('选择举报但未通过资料门禁时不展示原因菜单', async () => {
  const originalLogin = userService.login;
  let actionSheetCalls = 0;
  userService.login = async () => ({ profileComplete: false });
  const context = loadCommunityPage();
  global.wx.showActionSheet = ({ itemList, success }) => {
    actionSheetCalls += 1;
    assert.deepEqual(itemList, ['举报']);
    success({ tapIndex: 0 });
  };
  try {
    context.page.setData({ posts: [{ id: 'post-1', viewerIsAuthor: false }] });
    await context.page.handlePostAction({ currentTarget: { dataset: { id: 'post-1' } } });
    assert.equal(actionSheetCalls, 1);
    assert.equal(context.navigations.at(-1).url, '/subpackages/profile/edit/index');
  } finally {
    userService.login = originalLogin;
    unloadCommunityPage(context);
  }
});

test('删除墓碑过滤删除期间发起的晚到刷新结果', async () => {
  const originalListPosts = communityService.listPosts;
  const originalDeletePost = communityService.deletePost;
  const listResponse = deferred();
  communityService.listPosts = () => listResponse.promise;
  communityService.deletePost = async () => ({ deleted: true });
  const context = loadCommunityPage();
  global.wx.showActionSheet = ({ success }) => success({ tapIndex: 0 });
  global.wx.showModal = ({ success }) => success({ confirm: true });
  try {
    context.page.setData({ posts: [{ id: 'post-1', viewerIsAuthor: true }], loading: false });
    const refresh = context.page.loadPosts(false, true);
    await context.page.handlePostAction({ currentTarget: { dataset: { id: 'post-1' } } });
    listResponse.resolve({ items: [{ id: 'post-1', viewerIsAuthor: true, author: { nickname: '作者' }, content: '旧快照', createdAt: new Date().toISOString() }], nextCursor: null });
    await refresh;
    assert.deepEqual(context.page.data.posts, []);
  } finally {
    communityService.listPosts = originalListPosts;
    communityService.deletePost = originalDeletePost;
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
