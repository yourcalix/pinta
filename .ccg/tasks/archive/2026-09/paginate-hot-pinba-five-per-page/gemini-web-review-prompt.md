ROLE: frontend reviewer for a WeChat Mini Program

TASK:
请审查“发现”页「热门拼吧」从触底无限追加改为“每页最多 5 条、上一页/下一页离散翻页”的最终实现。请只评审，不要假设未提供的后端总数能力，也不要建议伪造总页数。

产品与交互目标：
1. 服务端是 opaque cursor（不透明游标）分页，每次请求 limit=5，没有 total。
2. 第一页最多 5 张活动卡；更多活动通过上一页/下一页呈现，移除了 onReachBottom。
3. 翻页器放在活动列表之后、“成团记忆”之前；标题右侧显示“第 N 页”，不显示总页数。
4. 下一页未缓存时保留当前五张卡，只把下一页按钮切成“加载中”；失败也保留当前页。
5. 上一页与已经访问过的下一页从页面实例缓存秒切，不重复请求。
6. 搜索、类型筛选、下拉刷新、onShow 刷新和到期刷新均以 replace 方式重建第一页数据，避免跨查询缓存污染。
7. 翻页完成后用 wx.pageScrollTo 滚回 #hot-pinba-heading。
8. 只有一页时隐藏翻页器；第一页上一页禁用；末页下一页显示“已是末页”并禁用。
9. 320px 窄屏仍保持单行，按钮 min-height=88rpx，满足 44px 触控热区。

核心状态：
```js
const PAGE_SIZE = 5;
const MAX_HIDDEN_PAGE_SKIPS = 1;

data: {
  activities: [],
  currentPage: 1,
  hasNextPage: false,
  hasPagination: false,
  isPaging: false,
  loading: true,
  refreshing: false,
  error: ''
}
```

核心分页实现：
```js
async fetchActivities(options = {}) {
  const keepContent = options.keepContent === true;
  const allowAutoFill = options.allowAutoFill !== false;
  const loadSeq = (this._loadSeq = (this._loadSeq || 0) + 1);
  this.clearExpirationTimer();
  const resetContent = !keepContent;
  if (resetContent) this.resetPaginationCache();
  this.setData({
    loading: resetContent || this.data.activities.length === 0,
    refreshing: true,
    isPaging: false,
    error: '',
    ...(resetContent ? {
      activities: [], currentPage: 1,
      hasNextPage: false, hasPagination: false
    } : {})
  });
  try {
    const snapshot = await this.requestActivityPage(undefined, allowAutoFill);
    if (loadSeq !== this._loadSeq) return false;
    this._pageCache = [snapshot];
    this._pageCursors = [undefined];
    if (snapshot.nextCursor) this._pageCursors[1] = snapshot.nextCursor;
    const activities = snapshot.activities;
    const hasNextPage = Boolean(snapshot.nextCursor);
    this.setData({
      activities, currentPage: 1, hasNextPage,
      hasPagination: hasNextPage,
      loading: false, refreshing: false, isPaging: false, error: ''
    });
    this.scheduleExpirationRefresh(activities);
    return true;
  } catch (error) {
    if (loadSeq !== this._loadSeq) return false;
    const hasContent = keepContent && this.data.activities.length > 0;
    this.setData({
      loading: false, refreshing: false, isPaging: false,
      error: hasContent ? '' : '活动列表加载失败，请重试'
    });
    this.scheduleExpirationRefresh(this.data.activities);
    return false;
  }
},

async requestActivityPage(cursor, allowAutoFill) {
  let requestCursor = cursor || undefined;
  let skips = 0;
  while (true) {
    const result = await activityService.list({
      type: this.data.type || undefined,
      keyword: this.data.appliedKeyword || undefined,
      limit: PAGE_SIZE,
      cursor: requestCursor
    });
    const activities = safetyService
      .filterHiddenActivities(result.items || [])
      .slice(0, PAGE_SIZE)
      .map(decorateActivity);
    const nextCursor = result.nextCursor ? String(result.nextCursor) : '';
    if (activities.length || !nextCursor || !allowAutoFill || skips >= MAX_HIDDEN_PAGE_SKIPS) {
      return { activities, nextCursor };
    }
    requestCursor = nextCursor;
    skips += 1;
  }
},

resetPaginationCache() {
  this._pageCache = [];
  this._pageCursors = [undefined];
},

applyPage(pageIndex, snapshot, shouldScroll) {
  const currentPage = pageIndex + 1;
  const hasNextPage = Boolean(snapshot.nextCursor || this._pageCache[pageIndex + 1]);
  this.setData({
    activities: snapshot.activities,
    currentPage, hasNextPage,
    hasPagination: currentPage > 1 || hasNextPage,
    isPaging: false, error: ''
  });
  this.scheduleExpirationRefresh(snapshot.activities);
  if (shouldScroll) this.scrollToHotPinba();
},

handlePrevPage() {
  if (this.data.loading || this.data.refreshing || this.data.isPaging || this.data.currentPage <= 1) return false;
  const pageIndex = this.data.currentPage - 2;
  const snapshot = this._pageCache && this._pageCache[pageIndex];
  if (!snapshot) return false;
  this.applyPage(pageIndex, snapshot, true);
  return true;
},

handleNextPage() {
  if (this.data.loading || this.data.refreshing || this.data.isPaging || !this.data.hasNextPage) return false;
  const pageIndex = this.data.currentPage;
  const cached = this._pageCache && this._pageCache[pageIndex];
  if (cached) {
    this.applyPage(pageIndex, cached, true);
    return true;
  }
  const cursor = this._pageCursors && this._pageCursors[pageIndex];
  if (!cursor) return false;
  this._loadSeq = this._loadSeq || 0;
  const loadSeq = this._loadSeq;
  this.setData({ isPaging: true });
  return this.loadNextPage(pageIndex, cursor, loadSeq);
},

async loadNextPage(pageIndex, cursor, loadSeq) {
  try {
    const snapshot = await this.requestActivityPage(cursor, true);
    if (loadSeq !== this._loadSeq) return false;
    if (!snapshot.activities.length) {
      this._pageCursors[pageIndex] = snapshot.nextCursor || undefined;
      if (!snapshot.nextCursor) {
        const currentIndex = this.data.currentPage - 1;
        if (this._pageCache[currentIndex]) this._pageCache[currentIndex].nextCursor = '';
        this.setData({
          hasNextPage: false,
          hasPagination: this.data.currentPage > 1,
          isPaging: false
        });
      } else {
        this.setData({ isPaging: false });
        wx.showToast({ title: '本页暂无可显示活动，请继续翻页', icon: 'none' });
      }
      return false;
    }
    this._pageCache[pageIndex] = snapshot;
    if (snapshot.nextCursor) this._pageCursors[pageIndex + 1] = snapshot.nextCursor;
    else this._pageCursors.length = pageIndex + 1;
    this.applyPage(pageIndex, snapshot, true);
    return true;
  } catch (error) {
    if (loadSeq !== this._loadSeq) return false;
    this.setData({ isPaging: false });
    this.scheduleExpirationRefresh(this.data.activities);
    if (!error || !error.handled) {
      wx.showToast({ title: '加载失败，请重试', icon: 'none' });
    }
    return false;
  }
}
```

WXML 关键结构：
```xml
<view id="hot-pinba-heading" class="session-heading memory-section-heading hot-pinba-heading">
  <view class="session-heading-watermark memory-heading-watermark">HOT PINBA</view>
  <view class="session-heading-title memory-title">{{hasActiveFilters ? '筛选结果' : '热门拼吧'}}</view>
  <text class="list-count" wx:if="{{!loading}}">第 {{currentPage}} 页</text>
</view>

<view wx:if="{{loading}}">5 个等尺寸骨架卡</view>
<view wx:elif="{{activities.length}}">
  <activity-card wx:for="{{activities}}" wx:key="id" ... />
</view>
<view wx:else>空状态</view>

<view wx:if="{{hasPagination}}" class="discover-pagination" role="navigation">
  <button bindtap="handlePrevPage"
    disabled="{{currentPage <= 1 || isPaging || refreshing}}">‹ 上一页</button>
  <view class="pagination-indicator">第 {{currentPage}} 页</view>
  <button bindtap="handleNextPage"
    disabled="{{!hasNextPage || isPaging || refreshing}}">
    {{isPaging ? '加载中' : (hasNextPage ? '下一页 ›' : '已是末页')}}
  </button>
</view>

<!-- 分页器之后才是静态“成团记忆” -->
<view class="memory-section memory-section--teaser">...</view>
<view wx:if="{{activities.length && !loading && !hasNextPage}}">
  — 已经到底啦 · 拼吧 —
</view>
```

布局参数：
- 标准屏：左右按钮各 204rpx，中间 180rpx；按钮 min-height 88rpx。
- 320px：左右按钮各 176rpx，中间 150rpx；按钮仍为 min-height 88rpx。
- 分页控件 margin: 28rpx auto 36rpx；窄屏 20rpx auto 28rpx。

已完成验证：
- 定向分页与发现页测试通过。
- 全量 npm run verify：311 tests，310 pass，0 fail，1 historical skip。
- git diff --check 通过。

请重点检查：
1. 1-based currentPage、0-based pageIndex 与 `_pageCursors[currentPage]` 是否存在 off-by-one。
2. replace、快速双击下一页、页面卸载或旧请求晚到时，`_loadSeq` 是否足以防止旧响应污染。
3. 搜索/筛选/刷新后缓存是否能可靠回到第一页，不会串用旧 cursor。
4. 已缓存页前后切换、末页状态、只有一页、过滤后整页为空这些边界是否正确。
5. 当前五张卡在下一页加载/失败时是否稳定保留。
6. WXML 条件、禁用态、文案和无障碍语义是否存在微信小程序兼容问题。
7. 375px 与 320px 的尺寸是否会换行、溢出或小于 44px 热区。
8. 分页器位于热门拼吧与成团记忆之间，页面终点文案位于全部模块最底部，语义是否合理。

OUTPUT:
- 先给总体判断。
- 按 Critical / Warning / Info 分级列出问题；无问题时明确写“无”。
- 每项必须写：准确位置、触发条件、用户影响、最小修改建议。
- 明确区分“代码可证实结论”和“必须真机验证项”。
- 最后给出“可以交付 / 修复后交付”的结论。
