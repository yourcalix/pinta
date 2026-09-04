请把下面这段粘贴到网页版 Gemini 3.7 Flash；如果有页面截图，请一并上传。拿到结果后直接贴回这里：

<GEMINI_WEB_PROMPT>
ROLE: frontend UI/UX analyzer and reviewer

PROJECT:
拼吧微信小程序，面向成年人。沿用亮蓝拼图纸纹、奶油白卡片、油画棒插画、翡翠绿强调色。

REVIEW TARGET:
发现页活动卡“左图右文”实装终审。请同时查看用户上传的最新发现页编译截图，不要将旧截图或设计稿当作新实装证据。

KNOWN CONSTRAINTS:
只修改发现页活动展示。共享组件默认 compact；仅发现页显式 variant="discover"，我的页继续无图卡片。不得增加业务入口、照片上传或变更接口/权限/分页/导航。三类图片是已有600×760透明WebP，采用aspectFit完整保留主体与留白，没有新增图片。
采用地点正常字号单行省略、标题最多2行、真实人数文本，移除发现卡进度条。字体设定>16或获取失败时允许文字流式扩展，卡片不固定高度。为可读性未盲从230–260rpx总高建议：最小300rpx，右侧标题30rpx、辅助24rpx，左图200×254rpx、窄屏170×230rpx，允许内容继续撑高。未知类型及图片错误提供中性回退。

LOCAL EVIDENCE:
npm run verify：183项测试，181通过，2项既有跳过，0失败；静态检查成功。新增4项测试覆盖变体隔离、白名单/异常回退、事件、字号、骨架。
开发者工具390×844/320×568模拟器已观察左图右文；320宽字号23设定时触发流式布局，另检查我的页仍为无图结构。测试数据为本地Mock；没有做双账号、云部署或真机联调，不声称真机性能/帧率或所有长文本已验证。

REVIEW QUESTIONS:
1. 三类插画完整性、有效占比、留白与右侧层级是否协调？
2. 窄屏、长标题/长地点/长昵称、两枚标签、人数是否会遮挡？请区分截图证据与代码推断。
3. compact样式/事件是否有连带变化？图片失败和未知类型回退是否健壮？
4. 骨架是否匹配新结构？aria语义、装饰图片与热区是否合理？
5. 只报告有依据的Critical/Warning/Info，不因测试通过就推断真机全通过，不保证恒定60fps或固定首屏卡片数。

OUTPUT:
1. 总体判断与最主要问题
2. Critical / Warning / Info 分级问题清单
3. 每项具体最小修改建议及理由
4. 已证实与待真机验证边界
5. 是否可交付；仅确有必要时提出产品决策
Do not assume missing business facts. Separate objective usability issues from subjective visual preferences. Do not output implementation code unless explicitly requested.

IMPLEMENTATION DIFF:
```diff
diff --git a/miniprogram/components/activity-card/index.js b/miniprogram/components/activity-card/index.js
index 847e2c4..426d9dc 100644
--- a/miniprogram/components/activity-card/index.js
+++ b/miniprogram/components/activity-card/index.js
@@ -1,10 +1,48 @@
 'use strict';
 
+const COVERS = Object.freeze({
+  companion: '/assets/images/publish/publish-cover-companion.webp',
+  sport: '/assets/images/publish/publish-cover-sport.webp',
+  food: '/assets/images/publish/publish-cover-food.webp'
+});
+
 Component({
   properties: {
-    item: { type: Object, value: null }
+    item: { type: Object, value: null },
+    variant: { type: String, value: 'compact' }
+  },
+  data: { coverSrc: '', coverFailed: false, largeText: false },
+  observers: {
+    'item, variant'(item, variant) {
+      const tone = item && item.typeTone;
+      const coverSrc = variant === 'discover' && Object.prototype.hasOwnProperty.call(COVERS, tone) ? COVERS[tone] : '';
+      if (coverSrc !== this.data.coverSrc) this.setData({ coverSrc, coverFailed: false });
+    }
+  },
+  lifetimes: {
+    attached() { this.refreshTextSize(); }
+  },
+  pageLifetimes: {
+    show() { this.refreshTextSize(); }
   },
   methods: {
+    refreshTextSize() {
+      if (this.data.variant !== 'discover') return;
+      try {
+        const info = typeof wx === 'undefined' ? null
+          : typeof wx.getAppBaseInfo === 'function' ? wx.getAppBaseInfo()
+            : typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : null;
+        const size = Number(info && info.fontSizeSetting);
+        this.setData({ largeText: !Number.isFinite(size) || size <= 0 || size > 16 });
+      } catch (error) {
+        // If sizing is unavailable, prefer readable flowing text to truncation.
+        this.setData({ largeText: true });
+      }
+    },
+    handleCoverError(event) {
+      const src = event && event.currentTarget && event.currentTarget.dataset.src;
+      if (src && src === this.data.coverSrc) this.setData({ coverFailed: true });
+    },
     handleTap() {
       if (this.data.item) this.triggerEvent('select', { id: this.data.item.id });
     }
diff --git a/miniprogram/components/activity-card/index.wxml b/miniprogram/components/activity-card/index.wxml
index 135275d..1cb7047 100644
--- a/miniprogram/components/activity-card/index.wxml
+++ b/miniprogram/components/activity-card/index.wxml
@@ -1,4 +1,25 @@
-<view wx:if="{{item}}" class="activity-card activity-card--{{item.typeTone}}" bindtap="handleTap" hover-class="activity-card--pressed" hover-stay-time="80" role="button" aria-label="{{item.accessibilityLabel}}">
+<view wx:if="{{item && variant === 'discover'}}" class="activity-card activity-card--discover activity-card--{{item.typeTone}} {{largeText ? 'activity-card--large-text' : ''}}" bindtap="handleTap" hover-class="activity-card--pressed" hover-stay-time="80" role="button" aria-label="{{item.accessibilityLabel}}">
+  <view class="card-cover card-cover--{{item.typeTone}}" aria-hidden="true">
+    <image wx:if="{{coverSrc && !coverFailed}}" class="card-cover-image" src="{{coverSrc}}" data-src="{{coverSrc}}" mode="aspectFit" lazy-load="{{true}}" binderror="handleCoverError" aria-hidden="true" />
+    <view wx:else class="card-cover-fallback"><text class="cover-fallback-symbol">✦</text><text>活动拼单</text></view>
+  </view>
+  <view class="card-copy">
+    <view class="card-head">
+      <view class="type-tag type-tag--{{item.typeTone}}"><text>{{item.typeLabel}}</text></view>
+      <status-badge label="{{item.statusLabel}}" tone="{{item.statusTone}}" />
+    </view>
+    <view class="activity-title"><text wx:if="{{item.legacy && item.legacy.readOnly}}" class="archive-prefix">历史归档 · </text>{{item.title}}</view>
+    <view class="meta-list">
+      <view class="meta-item"><text class="meta-icon" aria-hidden="true">◷</text><text class="meta-text">{{item.displayTime}}</text></view>
+      <view class="meta-item"><text class="meta-icon" aria-hidden="true">⌖</text><text class="meta-text meta-text--place">{{item.sceneLine}}</text></view>
+    </view>
+    <view class="card-footer">
+      <view class="owner-line"><view class="owner-avatar" aria-hidden="true">{{item.ownerInitial}}</view><text class="owner-name">{{item.ownerNickname}}</text></view>
+      <view class="capacity-link"><text>{{item.capacityLabel}}</text><text class="capacity-arrow" aria-hidden="true">›</text></view>
+    </view>
+  </view>
+</view>
+<view wx:elif="{{item}}" class="activity-card activity-card--{{item.typeTone}}" bindtap="handleTap" hover-class="activity-card--pressed" hover-stay-time="80" role="button" aria-label="{{item.accessibilityLabel}}">
   <view class="card-head">
     <view class="card-tags">
       <view class="type-tag type-tag--{{item.typeTone}}"><text class="type-symbol" aria-hidden="true">{{item.typeIcon}}</text><text>{{item.typeLabel}}</text></view>
diff --git a/miniprogram/components/activity-card/index.wxss b/miniprogram/components/activity-card/index.wxss
index 8278aa0..f4cfea3 100644
--- a/miniprogram/components/activity-card/index.wxss
+++ b/miniprogram/components/activity-card/index.wxss
@@ -148,3 +148,71 @@
   .activity-title { font-size: 29rpx; }
   .owner-name { max-width: 180rpx; }
 }
+
+/* Opt-in discovery layout. The compact personal-center card stays unchanged. */
+.activity-card--discover {
+  display: flex;
+  align-items: center;
+  gap: 20rpx;
+  box-sizing: border-box;
+  min-height: 300rpx;
+  padding: 18rpx;
+}
+.activity-card--discover::before { display: none; }
+.card-cover {
+  position: relative;
+  flex: 0 0 200rpx;
+  width: 200rpx;
+  height: 254rpx;
+  overflow: hidden;
+  background: #eee9df;
+  border-radius: 20rpx 17rpx 22rpx 18rpx;
+  pointer-events: none;
+}
+.card-cover--companion { background: #edf4fd; }
+.card-cover--sport { background: #f1effb; }
+.card-cover--food { background: #fff3e9; }
+.card-cover-image { display: block; width: 100%; height: 100%; pointer-events: none; }
+.card-cover-fallback {
+  display: flex;
+  height: 100%;
+  flex-direction: column;
+  align-items: center;
+  justify-content: center;
+  gap: 16rpx;
+  color: #63746c;
+  font-size: 24rpx;
+}
+.cover-fallback-symbol { font-size: 64rpx; color: #16835c; }
+.card-copy { flex: 1; min-width: 0; }
+.activity-card--discover .card-head { gap: 8rpx; }
+.activity-card--discover .type-tag { padding: 5rpx 10rpx; font-size: 24rpx; }
+.activity-card--discover .activity-title {
+  display: -webkit-box;
+  -webkit-box-orient: vertical;
+  -webkit-line-clamp: 2;
+  overflow: hidden;
+  margin-top: 12rpx;
+  font-size: 30rpx;
+  line-height: 1.35;
+  overflow-wrap: anywhere;
+}
+.archive-prefix { font-size: 24rpx; color: #65675f; font-weight: 500; }
+.activity-card--discover .meta-list { margin-top: 12rpx; }
+.activity-card--discover .meta-item { gap: 6rpx; font-size: 24rpx; }
+.activity-card--discover .meta-icon { flex-basis: 24rpx; width: 24rpx; }
+.activity-card--discover .meta-text { flex: 1; }
+.activity-card--discover .meta-text--place { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
+.activity-card--discover .card-footer { margin-top: 14rpx; padding-top: 0; border-top: 0; gap: 8rpx; flex-wrap: wrap; }
+.activity-card--discover .owner-line { flex: 1; gap: 8rpx; font-size: 24rpx; }
+.activity-card--discover .owner-avatar { flex-basis: 32rpx; width: 32rpx; height: 32rpx; font-size: 20rpx; }
+.activity-card--discover .capacity-link { margin-left: auto; font-size: 24rpx; }
+.activity-card--large-text .activity-title { display: block; -webkit-line-clamp: unset; overflow: visible; }
+.activity-card--large-text .meta-text--place { white-space: normal; overflow: visible; }
+.activity-card--large-text .owner-line { flex-basis: 100%; }
+.activity-card--large-text .owner-name { white-space: normal; overflow-wrap: anywhere; }
+@media (max-width: 340px) {
+  .activity-card--discover { gap: 16rpx; padding: 16rpx; }
+  .card-cover { flex-basis: 170rpx; width: 170rpx; height: 230rpx; }
+  .activity-card--discover .activity-title { font-size: 30rpx; }
+}
diff --git a/miniprogram/pages/discover/index.wxml b/miniprogram/pages/discover/index.wxml
index a6158a8..2d38d57 100644
--- a/miniprogram/pages/discover/index.wxml
+++ b/miniprogram/pages/discover/index.wxml
@@ -32,10 +32,10 @@
       <view class="list-heading-meta"><text class="list-count" wx:if="{{!loading}}">{{activities.length}} 个活动</text><button wx:if="{{hasActiveFilters}}" class="clear-filter-button" bindtap="handleClearFilters">清除筛选</button></view>
     </view>
 
-    <view wx:if="{{loading}}" class="skeleton-list"><view wx:for="{{[1,2,3]}}" wx:key="*this" class="skeleton-card"><view class="skeleton-line skeleton-line--short"></view><view class="skeleton-line skeleton-line--title"></view><view class="skeleton-line"></view><view class="skeleton-line skeleton-line--medium"></view></view></view>
+    <view wx:if="{{loading}}" class="skeleton-list" aria-label="正在加载活动"><view wx:for="{{[1,2,3]}}" wx:key="*this" class="skeleton-card" aria-hidden="true"><view class="skeleton-cover"></view><view class="skeleton-copy"><view class="skeleton-line skeleton-line--short"></view><view class="skeleton-line skeleton-line--title"></view><view class="skeleton-line"></view><view class="skeleton-line skeleton-line--medium"></view></view></view></view>
 
     <view wx:elif="{{activities.length}}">
-      <activity-card wx:for="{{activities}}" wx:key="id" item="{{item}}" bindselect="handleCardSelect" />
+      <activity-card wx:for="{{activities}}" wx:key="id" item="{{item}}" variant="discover" bindselect="handleCardSelect" />
       <view wx:if="{{loadingMore || loadMoreError || !hasMore}}" class="list-footer" aria-role="status">
         <view wx:if="{{loadingMore}}" class="footer-state"><view class="footer-spinner" aria-hidden="true"></view><text>正在加载更多…</text></view>
         <button wx:elif="{{loadMoreError}}" class="footer-retry-button" bindtap="handleRetryLoadMore">加载更多失败，点击重试</button>
diff --git a/miniprogram/pages/discover/index.wxss b/miniprogram/pages/discover/index.wxss
index c33cf15..3f8ff96 100644
--- a/miniprogram/pages/discover/index.wxss
+++ b/miniprogram/pages/discover/index.wxss
@@ -256,10 +256,17 @@
 }
 
 .skeleton-card {
+  display: flex;
+  align-items: center;
+  gap: 20rpx;
+  box-sizing: border-box;
+  min-height: 300rpx;
   margin-bottom: 20rpx;
-  padding: 26rpx 28rpx;
+  padding: 18rpx;
   border-radius: 28rpx 24rpx 30rpx 26rpx;
 }
+.skeleton-cover { flex: 0 0 200rpx; width: 200rpx; height: 254rpx; background: #e8ddce; border-radius: 20rpx; }
+.skeleton-copy { flex: 1; min-width: 0; }
 
 .skeleton-line {
   height: 22rpx;
@@ -319,6 +326,8 @@
 }
 
 @media (max-width: 340px) {
+  .skeleton-card { gap: 16rpx; padding: 16rpx; }
+  .skeleton-cover { flex-basis: 170rpx; width: 170rpx; height: 230rpx; }
   .discover-content { padding-right: 22rpx; padding-left: 22rpx; }
   .discover-title { font-size: 38rpx; }
   .discover-subtitle { font-size: 22rpx; }

```
</GEMINI_WEB_PROMPT>

