<GEMINI_WEB_PROMPT>
ROLE: frontend implementation reviewer
审查“我的”下半区暖米白风格实际实现，上一轮方案APPROVE_PLAN。以下为完整WXML/WXSS/JSON，未省略事件、数据属性和状态。WXSS末尾的限定选择器覆盖原样式；以最终级联判断。
边界：profile-stage背景、资料、统计、待办、页面加载/错误、JS服务和全局TabBar都未改。已用脚本与HEAD对比验证：my-activities之前WXML完全一致，原CSS除下方面板164→200rpx留白外一致；新增规则全部限定profile-content-sheet。JSON只改Bottom托底。
实现：#F9F7F2下方面板，白色圆角卡、琥珀色分类和节点，成员头像/人数/状态移入卡内底部；状态仍消费原statusLabel/statusTone，局部样式保持语义色。日期单独一行。四栏短文案，数字99+显示、aria-label完整真实数。主字28、辅助24rpx，窄屏分类竖排，min-height避免固定卡高。时间地点可断行。
上方保持原深色及白色状态栏文字，禁止建议整页改黑字。首页/消息参考是暖米白白卡，不是全页统一必须去除上方背景。
现有全局view/text/button等border-box。TabBar高度116rpx，bottom24rpx+SafeArea。底部面板200rpx+SafeArea。未新增图片；主包1,701,540bytes。371测试通过、0失败、1跳过，项目结构语法ok。没有本次真机截图，不可推断视觉/读屏已验收。
请检查：作用域是否污染上方；四栏在320px和大字下；日期与卡片、成员行空间；status可见；头像binderror索引与导航绑定是否保留；空态按钮、长文本、自然滚动和底部安全区。
只聚焦本次差异，历史问题单列。输出Critical/Warning/Info（文件、具体原因、最小修正），最后APPROVE/REVISE；不要生成不存在的业务事实或测试结论。
FILE: pages/user/index.wxml
```
<view class="page user-page global-background-host">
  <image class="global-page-background" src="/assets/images/shared/shared-paper-bg.jpg" mode="aspectFill" aria-hidden="true" />
  <view class="global-page-background-tint" aria-hidden="true"></view>

  <view wx:if="{{loading}}" class="page-state-layer" style="margin-top: {{contentTopInset}}px;" role="status" aria-label="正在整理你的个人主页">
    <view class="profile-loading-avatar skeleton-shimmer"></view>
    <view class="profile-loading-line profile-loading-line--title skeleton-shimmer"></view>
    <view class="profile-loading-line skeleton-shimmer"></view>
  </view>

  <view wx:elif="{{error}}" class="page-state-layer page-state-layer--error" style="margin-top: {{contentTopInset}}px;">
    <view class="state-symbol" aria-hidden="true">!</view>
    <view class="state-title">{{error}}</view>
    <view class="state-copy">个人资料或活动暂时没有加载出来，请稍后重试。</view>
    <button class="state-action" bindtap="loadDashboard" hover-class="soft-button--pressed">重新加载</button>
  </view>

  <block wx:else>
    <view class="profile-stage" style="padding-top: {{contentTopInset}}px;" role="region" aria-label="个人主页，{{user.profile.nickname}}，{{profileGenderLabel}}，已确认年满18岁">
      <view class="profile-atmosphere" aria-hidden="true">
        <view class="profile-atmosphere-base"></view>
        <image class="profile-atmosphere-image {{profileCoverUsesAvatar ? 'profile-atmosphere-image--avatar' : 'profile-atmosphere-image--seascape'}}" src="{{profileCoverPath}}" mode="aspectFill" binderror="handleAvatarImageError" aria-hidden="true" />
        <view class="profile-atmosphere-shade {{profileCoverUsesAvatar ? '' : 'profile-atmosphere-shade--seascape'}}"></view>
      </view>
      <button class="profile-background-preview" bindtap="handleBackgroundPreview" hover-class="profile-background-preview--pressed" hover-stay-time="80" aria-label="查看背景大图"></button>

      <view class="profile-stage-content">
        <view class="profile-action-row" style="top: calc({{profileActionTop}}px - {{contentTopInset}}px); right: {{profileActionRight}}px;">
          <button class="profile-edit-button" bindtap="handleProfile" hover-class="glass-button--pressed" aria-label="编辑个人资料">
            <view class="profile-edit-surface"><text aria-hidden="true">✎</text><text>编辑主页</text></view>
          </button>
        </view>

        <view class="profile-identity">
          <button class="profile-avatar-shell" bindtap="handleAvatarPreview" hover-class="profile-avatar-shell--pressed" hover-stay-time="80" aria-label="查看头像大图"><image class="profile-avatar" src="{{profileAvatarPath}}" mode="{{hasCustomAvatar ? 'aspectFill' : 'aspectFit'}}" binderror="handleAvatarImageError" aria-hidden="true" /></button>
          <view class="profile-name-block">
            <view class="profile-name-row"><text class="profile-name">{{user.profile.nickname}}</text><text class="profile-gender profile-gender--{{user.profile.gender === 'FEMALE' ? 'female' : 'male'}}" aria-label="性别，{{profileGenderLabel}}">{{user.profile.gender === 'FEMALE' ? '♀' : '♂'}}</text></view>
            <view class="profile-verification">已确认年满18岁</view>
          </view>
        </view>

        <button class="profile-intro {{hasProfileIntro ? 'profile-intro--filled' : ''}}" bindtap="handleProfile" hover-class="glass-button--pressed" aria-label="编辑兴趣标签，当前为{{profileIntro}}">
          <text class="profile-intro-mark" aria-hidden="true">“</text><text class="profile-intro-text">{{profileIntro}}</text><text class="profile-intro-pencil" aria-hidden="true">✎</text>
        </button>

        <view class="profile-metrics" role="group" aria-label="我的活动概览">
          <button class="metric-item" data-value="owned" bindtap="handleMetricTap" hover-class="metric-item--pressed" hover-stay-time="80" aria-label="我发起的活动，{{owned.length}}场，点击切换列表"><text class="metric-value">{{owned.length}}</text><text class="metric-label">我发起的</text></button>
          <view class="metric-divider" aria-hidden="true"></view>
          <button class="metric-item" data-value="joined" bindtap="handleMetricTap" hover-class="metric-item--pressed" hover-stay-time="80" aria-label="我加入的活动，{{joined.length}}场，点击切换列表"><text class="metric-value">{{joined.length}}</text><text class="metric-label">我加入的</text></button>
          <view class="metric-divider" aria-hidden="true"></view>
          <button class="metric-item" data-value="formed" bindtap="handleMetricTap" hover-class="metric-item--pressed" hover-stay-time="80" aria-label="已成团活动，{{formed.length}}场，点击切换列表"><text class="metric-value">{{formed.length}}</text><text class="metric-label">已成团</text></button>
        </view>

        <scroll-view wx:if="{{tasks.length}}" class="quick-task-strip" scroll-x enhanced show-scrollbar="{{false}}" aria-label="待处理事项">
          <view class="quick-task-row">
            <button wx:for="{{tasks}}" wx:key="id" class="quick-task-card" data-task="{{item}}" bindtap="handleTaskTap" hover-class="glass-button--pressed" hover-stay-time="80" aria-label="待处理事项，{{item.title}}，点击处理">
              <text class="quick-task-icon" aria-hidden="true">{{index === 0 ? '!' : '·'}}</text>
              <view class="quick-task-copy task-main"><text class="quick-task-title">{{item.title}}</text><text class="quick-task-time">{{item.displayTime}}</text></view>
              <text class="quick-task-arrow" aria-hidden="true">›</text>
            </button>
          </view>
        </scroll-view>
      </view>
    </view>

    <view id="my-activities" class="profile-content-sheet">
      <view class="list-tabs" role="tablist" aria-label="切换我的拼单列表">
        <button class="list-tab {{currentList === 'owned' ? 'list-tab--active' : ''}}" data-value="owned" bindtap="handleListChange" role="tab" aria-selected="{{currentList === 'owned'}}" aria-label="发起活动，{{owned.length}}场"><text>发起</text><text class="tab-count" aria-hidden="true">{{owned.length > 99 ? '99+' : owned.length}}</text></button>
        <button class="list-tab {{currentList === 'joined' ? 'list-tab--active' : ''}}" data-value="joined" bindtap="handleListChange" role="tab" aria-selected="{{currentList === 'joined'}}" aria-label="参与活动，{{joined.length}}场"><text>参与</text><text class="tab-count" aria-hidden="true">{{joined.length > 99 ? '99+' : joined.length}}</text></button>
        <button class="list-tab {{currentList === 'formed' ? 'list-tab--active' : ''}}" data-value="formed" bindtap="handleListChange" role="tab" aria-selected="{{currentList === 'formed'}}" aria-label="成团活动，{{formed.length}}场"><text>成团</text><text class="tab-count" aria-hidden="true">{{formed.length > 99 ? '99+' : formed.length}}</text></button>
        <button class="list-tab {{currentList === 'history' ? 'list-tab--active' : ''}}" data-value="history" bindtap="handleListChange" role="tab" aria-selected="{{currentList === 'history'}}" aria-label="历史活动，{{history.length}}场"><text>历史</text><text class="tab-count" aria-hidden="true">{{history.length > 99 ? '99+' : history.length}}</text></button>
      </view>

      <view class="timeline-list">
        <view wx:for="{{currentItems}}" wx:for-index="activityIndex" wx:key="id" class="timeline-entry">
          <view class="timeline-heading">
            <view class="timeline-date"><text>{{item.timelineDate}}</text><text class="timeline-weekday">{{item.timelineDay}}</text></view>
          </view>

          <view class="timeline-track" aria-hidden="true"><view class="timeline-dot"></view></view>
          <view class="timeline-activity" data-id="{{item.id}}" bindtap="handleActivityTap" hover-class="timeline-activity--pressed" hover-stay-time="80" role="button" aria-label="{{item.accessibilityLabel}}">
            <view class="timeline-cover timeline-cover--{{item.typeTone}}" aria-hidden="true"><image class="timeline-cover-image" src="{{item.profileCover}}" mode="aspectFit" lazy-load="{{true}}" aria-hidden="true" /></view>
            <view class="timeline-copy">
              <view class="timeline-tags"><view class="timeline-type timeline-type--{{item.typeTone}}">{{item.typeLabel}}</view></view>
              <view class="timeline-title"><text wx:if="{{item.legacy && item.legacy.readOnly}}" class="timeline-archive">历史归档 · </text>{{item.title}}</view>
              <view class="timeline-meta"><text class="timeline-meta-icon" aria-hidden="true">◷</text><text>{{item.displayTime}}</text></view>
              <view class="timeline-meta"><text class="timeline-meta-icon" aria-hidden="true">⌖</text><text class="timeline-place">{{item.sceneLine}}</text></view>
              <view class="timeline-card-footer">
                <view class="timeline-summary">
                  <view class="timeline-avatar-group" aria-hidden="true">
                    <view wx:for="{{item.visibleAvatarSlots}}" wx:for-item="slot" wx:for-index="slotIndex" wx:key="id" class="timeline-avatar {{slot.empty ? 'timeline-avatar--empty' : ''}}"><text wx:if="{{slot.empty}}">·</text><image wx:else src="{{slot.src}}" mode="{{slot.mode}}" data-activity-index="{{activityIndex}}" data-activity-id="{{item.id}}" data-slot-index="{{slotIndex}}" data-slot-id="{{slot.id}}" data-src="{{slot.src}}" lazy-load="{{true}}" binderror="handleTimelineAvatarError" aria-hidden="true" /></view>
                  </view>
                  <text>{{item.timelinePeopleLabel}}</text>
                </view>
                <view class="timeline-capacity"><text class="sheet-status sheet-status--{{item.statusTone}}">{{item.statusLabel}}</text><text>{{item.capacityLabel}}</text></view>
              </view>
            </view>
          </view>
        </view>

        <view wx:if="{{!currentItems.length}}" class="list-empty">
          <view class="empty-puzzle" aria-hidden="true"><view class="empty-puzzle-eye empty-puzzle-eye--left"></view><view class="empty-puzzle-eye empty-puzzle-eye--right"></view><view class="empty-puzzle-smile"></view></view>
          <view class="empty-title">暂无相关拼单记录</view>
          <view class="empty-copy">去发现页看看正在发生什么吧。</view>
          <button class="empty-action" bindtap="handleGoDiscover" hover-class="soft-button--pressed">去发现页看看</button>
        </view>
      </view>
    </view>
  </block>
</view>
```

FILE: pages/user/index.wxss
```
.user-page {
  position: relative;
  box-sizing: border-box;
  width: 100vw;
  min-height: 100vh;
  margin: 0;
  padding-top: 0;
  padding-right: 0;
  padding-bottom: 0;
  padding-left: 0;
  overflow-x: hidden;
  background: #081e36;
}

button::after { display: none; }

.profile-stage {
  position: relative;
  z-index: 1;
  box-sizing: border-box;
  width: 100vw;
  min-height: 560rpx;
  margin: 0;
  overflow: hidden;
  color: #fff;
}

.profile-atmosphere {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #081e36;
  pointer-events: none;
}

.profile-atmosphere-base {
  position: absolute;
  inset: 0;
  background: #075aa7;
}

.profile-atmosphere-image {
  position: absolute;
  pointer-events: none;
}

.profile-atmosphere-image--avatar {
  top: -28%;
  left: -20%;
  width: 140%;
  height: 156%;
  opacity: 0.68;
  filter: blur(35px);
  transform: translate3d(0, 0, 0) scale(1.4);
  transform-origin: center;
  will-change: transform;
}

.profile-atmosphere-image--seascape {
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 1;
  filter: none;
  transform: none;
}

.profile-atmosphere-shade {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 22% 35%, rgba(126, 207, 231, 0.32), transparent 42%),
    linear-gradient(180deg, rgba(7, 90, 167, 0.32) 0%, rgba(7, 65, 120, 0.48) 44%, rgba(8, 30, 54, 0.88) 100%);
}

.profile-atmosphere-shade--seascape {
  background: linear-gradient(
    180deg,
    rgba(12, 28, 48, 0.38) 0%,
    rgba(12, 28, 48, 0.15) 35%,
    rgba(8, 24, 44, 0.82) 80%,
    rgba(8, 24, 44, 0.96) 100%
  );
}

.profile-background-preview {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  line-height: 1;
  background: transparent;
}

.profile-background-preview--pressed {
  background: rgba(255, 255, 255, 0.06);
}

.profile-stage-content {
  position: relative;
  z-index: 2;
  box-sizing: border-box;
  min-height: 560rpx;
  padding: 12rpx 30rpx 72rpx;
  pointer-events: none;
}

.profile-action-row,
.profile-avatar-shell,
.profile-intro,
.profile-metrics,
.quick-task-strip {
  pointer-events: auto;
}

.profile-action-row {
  position: absolute;
  display: flex;
  min-height: 88rpx;
  align-items: center;
  justify-content: flex-end;
}

.profile-edit-button {
  display: inline-flex;
  box-sizing: border-box;
  min-width: 154rpx;
  min-height: 88rpx;
  margin: 0;
  padding: 0;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: transparent;
  border-radius: 999rpx;
  line-height: 1.2;
  white-space: nowrap;
}

.profile-edit-surface {
  display: inline-flex;
  box-sizing: border-box;
  min-height: 52rpx;
  padding: 0 20rpx;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  color: #fff;
  background: rgba(255, 255, 255, 0.2);
  border: 1rpx solid rgba(255, 255, 255, 0.34);
  border-radius: 999rpx;
  font-size: 22rpx;
  font-weight: 680;
}

.profile-identity {
  display: flex;
  min-width: 0;
  margin-top: 96rpx;
  align-items: center;
}

.profile-avatar-shell {
  flex: 0 0 132rpx;
  box-sizing: border-box;
  width: 132rpx;
  height: 132rpx;
  margin: 0;
  line-height: 1;
  padding: 3rpx;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.9);
  border: 4rpx solid rgba(255, 255, 255, 0.92);
  border-radius: 50%;
  box-shadow: 0 8rpx 22rpx rgba(0, 0, 0, 0.24);
}

.profile-avatar-shell--pressed {
  transform: scale(0.96);
  opacity: 0.88;
}

.profile-avatar {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 50%;
}

.profile-name-block {
  flex: 1;
  min-width: 0;
  margin-left: 24rpx;
}

.profile-name-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12rpx;
}

.profile-name {
  max-width: 320rpx;
  overflow: hidden;
  color: #fff;
  font-size: 36rpx;
  font-weight: 800;
  letter-spacing: 1rpx;
  line-height: 1.3;
  text-overflow: ellipsis;
  text-shadow: 0 3rpx 10rpx rgba(0, 0, 0, 0.26);
  white-space: nowrap;
}

.profile-gender {
  flex: 0 0 auto;
  color: #52c9ff;
  font-size: 31rpx;
  font-weight: 800;
  line-height: 1;
}

.profile-gender--female { color: #ff9bc0; }

.profile-verification {
  display: inline-flex;
  min-height: 36rpx;
  margin-top: 10rpx;
  padding: 3rpx 14rpx;
  align-items: center;
  color: #fff;
  background: rgba(22, 163, 106, 0.86);
  border-radius: 999rpx;
  font-size: 20rpx;
  font-weight: 650;
  line-height: 1.35;
}

.profile-intro {
  display: flex;
  box-sizing: border-box;
  width: 100%;
  min-height: 72rpx;
  margin: 22rpx 0 0;
  padding: 10rpx 14rpx;
  align-items: center;
  gap: 10rpx;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.82);
  background: rgba(7, 30, 60, 0.2);
  border: 2rpx dashed rgba(255, 255, 255, 0.38);
  border-radius: 18rpx;
  font-size: 24rpx;
  line-height: 1.4;
  text-align: left;
}

.profile-intro--filled {
  color: #fff;
  background: rgba(255, 255, 255, 0.14);
  border-width: 1rpx;
  border-color: rgba(255, 255, 255, 0.22);
  border-style: solid;
}

.profile-intro-mark {
  flex: 0 0 auto;
  color: rgba(255, 255, 255, 0.58);
  font-size: 42rpx;
  font-weight: 800;
  line-height: 1;
}

.profile-intro-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-intro-pencil { flex: 0 0 auto; font-size: 28rpx; }

.profile-metrics {
  display: flex;
  min-height: 112rpx;
  margin-top: 10rpx;
  align-items: center;
}

.metric-item {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 88rpx;
  margin: 0;
  padding: 8rpx 4rpx;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: transparent;
  border-radius: 18rpx;
  line-height: 1.15;
}

.metric-item--pressed {
  opacity: 0.8;
  transform: scale(0.96);
}

.metric-value {
  color: #fff;
  font-size: 38rpx;
  font-weight: 820;
}

.metric-label {
  margin-top: 6rpx;
  color: rgba(255, 255, 255, 0.76);
  font-size: 22rpx;
  white-space: nowrap;
}

.metric-divider {
  width: 2rpx;
  height: 50rpx;
  background: rgba(255, 255, 255, 0.22);
}

.quick-task-strip {
  width: calc(100% + 30rpx);
  margin-top: 8rpx;
  margin-right: -30rpx;
  white-space: nowrap;
}

.quick-task-row {
  display: inline-flex;
  gap: 14rpx;
  padding-right: 30rpx;
}

.quick-task-card {
  display: inline-flex;
  box-sizing: border-box;
  width: 330rpx;
  min-height: 88rpx;
  margin: 0;
  padding: 12rpx 16rpx;
  align-items: center;
  gap: 12rpx;
  color: #fff;
  background: rgba(255, 255, 255, 0.16);
  border: 2rpx solid rgba(255, 255, 255, 0.24);
  border-radius: 20rpx;
  text-align: left;
}

.quick-task-icon {
  display: flex;
  flex: 0 0 40rpx;
  width: 40rpx;
  height: 40rpx;
  align-items: center;
  justify-content: center;
  color: #08233d;
  background: #7fe2b4;
  border-radius: 50%;
  font-size: 25rpx;
  font-weight: 800;
}

.quick-task-copy {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
}

.task-main {
  min-width: 0;
  word-break: break-all;
}

.quick-task-title {
  overflow: hidden;
  font-size: 23rpx;
  font-weight: 680;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quick-task-time {
  margin-top: 4rpx;
  color: rgba(255, 255, 255, 0.66);
  font-size: 20rpx;
}

.quick-task-arrow { flex: 0 0 auto; font-size: 32rpx; }

.glass-button--pressed {
  opacity: 0.72;
  transform: scale(0.98);
}

.profile-content-sheet {
  position: relative;
  z-index: 3;
  box-sizing: border-box;
  width: 100vw;
  min-height: 520rpx;
  margin-top: -40rpx;
  margin-right: 0;
  margin-left: 0;
  padding: 0 28rpx;
  padding-bottom: calc(200rpx + env(safe-area-inset-bottom));
  overflow: hidden;
  background: #fff;
  border-radius: 36rpx 36rpx 0 0;
  box-shadow: 0 -12rpx 30rpx rgba(7, 35, 70, 0.12);
}

.list-tabs {
  display: flex;
  height: 96rpx;
  align-items: stretch;
  border-bottom: 2rpx solid #edf0f2;
}

.list-tab {
  position: relative;
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 88rpx;
  margin: 0;
  padding: 10rpx 2rpx 12rpx;
  align-items: center;
  justify-content: center;
  gap: 7rpx;
  color: #7a818b;
  background: transparent;
  border-radius: 0;
  font-size: 26rpx;
  line-height: 1.2;
  white-space: nowrap;
}

.list-tab--active {
  color: #111827;
  font-size: 30rpx;
  font-weight: 800;
}

.list-tab--active::before {
  position: absolute;
  bottom: 7rpx;
  left: 50%;
  width: 40rpx;
  height: 6rpx;
  background: #16a36a;
  border-radius: 999rpx;
  content: '';
  transform: translateX(-50%) rotate(-2deg);
}

.tab-count {
  min-width: 28rpx;
  padding: 2rpx 7rpx;
  color: #63707d;
  background: #f0f2f3;
  border-radius: 999rpx;
  font-size: 19rpx;
  font-weight: 650;
  text-align: center;
}

.list-tab--active .tab-count {
  color: #0e6848;
  background: #dcf5e7;
}

.timeline-list { padding-top: 20rpx; }

.timeline-entry {
  position: relative;
  padding: 8rpx 0 28rpx;
}

.timeline-heading {
  display: flex;
  min-height: 54rpx;
  align-items: center;
  gap: 14rpx;
  color: #7a818b;
}

.timeline-date {
  display: flex;
  flex: 0 0 auto;
  align-items: baseline;
  gap: 8rpx;
  color: #111827;
  font-size: 27rpx;
  font-weight: 820;
  letter-spacing: 1rpx;
}

.timeline-weekday {
  color: #747c86;
  font-size: 20rpx;
  font-weight: 600;
}

.timeline-summary {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: 9rpx;
  overflow: hidden;
  font-size: 21rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timeline-avatar-group { display: flex; flex: 0 0 auto; align-items: center; }

.timeline-avatar {
  display: flex;
  box-sizing: border-box;
  width: 32rpx;
  height: 32rpx;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  color: #8c949b;
  background: #f5f6f8;
  border: 2rpx solid #fff;
  border-radius: 50%;
}

.timeline-avatar + .timeline-avatar { margin-left: -9rpx; }
.timeline-avatar image { display: block; width: 100%; height: 100%; border-radius: 50%; pointer-events: none; }
.timeline-avatar--empty { background: #eceff0; }

.timeline-capacity {
  flex: 0 0 auto;
  color: #7a818b;
  font-size: 20rpx;
  white-space: nowrap;
}

.timeline-track {
  position: absolute;
  top: 70rpx;
  bottom: -4rpx;
  left: 20rpx;
  width: 2rpx;
  background: repeating-linear-gradient(to bottom, #d9dee2 0, #d9dee2 8rpx, transparent 8rpx, transparent 15rpx);
}

.timeline-dot {
  position: absolute;
  top: 0;
  left: -5rpx;
  width: 12rpx;
  height: 12rpx;
  background: #16a36a;
  border: 2rpx solid #dff5e9;
  border-radius: 50%;
}

.timeline-activity {
  position: relative;
  display: flex;
  box-sizing: border-box;
  min-height: 224rpx;
  margin: 12rpx 0 0 38rpx;
  padding: 12rpx;
  align-items: center;
  gap: 20rpx;
  background: #f8f9f9;
  border: 2rpx solid #eef0f1;
  border-radius: 22rpx;
  box-shadow: 0 10rpx 26rpx rgba(17, 24, 39, 0.07);
  transition: transform 120ms ease, opacity 120ms ease;
}

.timeline-activity--pressed {
  opacity: 0.84;
  transform: scale(0.988);
}

.timeline-cover {
  flex: 0 0 160rpx;
  width: 160rpx;
  height: 200rpx;
  overflow: hidden;
  background: #edf4fd;
  border-radius: 17rpx;
  pointer-events: none;
}

.timeline-cover--sport { background: #f1effb; }
.timeline-cover--food { background: #fff3e9; }
.timeline-cover-image { display: block; width: 100%; height: 100%; pointer-events: none; }

.timeline-copy { flex: 1; min-width: 0; }
.timeline-tags { display: flex; align-items: center; justify-content: space-between; gap: 8rpx; }

.timeline-type {
  padding: 5rpx 10rpx;
  color: #176c97;
  background: #dff3ef;
  border-radius: 10rpx;
  font-size: 20rpx;
  font-weight: 700;
}

.timeline-type--sport { color: #55439f; background: #ece7f7; }
.timeline-type--food { color: #b45123; background: #ffead8; }

.timeline-title {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  margin-top: 12rpx;
  overflow: hidden;
  color: #111827;
  font-size: 28rpx;
  font-weight: 780;
  line-height: 1.38;
  overflow-wrap: anywhere;
}

.timeline-archive { color: #7b838b; font-size: 21rpx; font-weight: 600; }

.timeline-meta {
  display: flex;
  min-width: 0;
  margin-top: 9rpx;
  align-items: center;
  gap: 8rpx;
  overflow: hidden;
  color: #64748b;
  font-size: 21rpx;
  line-height: 1.35;
  white-space: nowrap;
}

.timeline-meta-icon { flex: 0 0 24rpx; color: #8c959d; text-align: center; }
.timeline-place { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.list-empty {
  min-height: 390rpx;
  padding: 64rpx 20rpx 40rpx;
  text-align: center;
}

.empty-puzzle {
  position: relative;
  width: 82rpx;
  height: 72rpx;
  margin: 0 auto;
  background: #b6e2c9;
  border: 4rpx solid #16825b;
  border-radius: 22rpx 19rpx 23rpx 20rpx;
  opacity: 0.82;
}

.empty-puzzle::before {
  position: absolute;
  top: -20rpx;
  left: 25rpx;
  width: 28rpx;
  height: 28rpx;
  background: #b6e2c9;
  border: 4rpx solid #16825b;
  border-bottom: 0;
  border-radius: 50% 50% 0 0;
  content: '';
}

.empty-puzzle-eye { position: absolute; top: 24rpx; width: 7rpx; height: 7rpx; background: #123451; border-radius: 50%; }
.empty-puzzle-eye--left { left: 22rpx; }
.empty-puzzle-eye--right { right: 22rpx; }
.empty-puzzle-smile { position: absolute; top: 38rpx; left: 33rpx; width: 14rpx; height: 7rpx; border-bottom: 3rpx solid #123451; border-radius: 0 0 14rpx 14rpx; }

.empty-title,
.state-title {
  margin-top: 24rpx;
  color: #17202a;
  font-size: 29rpx;
  font-weight: 760;
  line-height: 1.4;
}

.empty-copy,
.state-copy {
  margin-top: 8rpx;
  color: #697785;
  font-size: 24rpx;
  line-height: 1.5;
}

.empty-action,
.state-action {
  display: inline-flex;
  min-height: 88rpx;
  margin: 24rpx auto 0;
  padding: 14rpx 30rpx;
  align-items: center;
  justify-content: center;
  color: #0f704e;
  background: #dff5e9;
  border-radius: 999rpx;
  font-size: 25rpx;
  font-weight: 700;
}

.soft-button--pressed { opacity: 0.75; transform: scale(0.98); }

.page-state-layer {
  position: relative;
  z-index: 2;
  box-sizing: border-box;
  width: calc(100% - 56rpx);
  min-height: 420rpx;
  margin: 30rpx 28rpx 0;
  padding: 64rpx 30rpx;
  color: #fff;
  background: rgba(255, 255, 255, 0.14);
  border: 2rpx solid rgba(255, 255, 255, 0.24);
  border-radius: 30rpx;
  text-align: center;
}

.page-state-layer--error { background: #fff; }
.profile-loading-avatar { width: 132rpx; height: 132rpx; margin: 0 auto; border-radius: 50%; }
.profile-loading-line { width: 54%; height: 24rpx; margin: 18rpx auto 0; border-radius: 999rpx; }
.profile-loading-line--title { width: 34%; height: 34rpx; margin-top: 28rpx; }

.skeleton-shimmer {
  background: linear-gradient(100deg, rgba(255, 255, 255, 0.18) 25%, rgba(255, 255, 255, 0.42) 42%, rgba(255, 255, 255, 0.18) 60%);
  background-size: 260% 100%;
  animation: skeleton-shimmer 1.35s ease-in-out infinite;
}

@keyframes skeleton-shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}

.state-symbol {
  display: flex;
  width: 72rpx;
  height: 72rpx;
  margin: 0 auto;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: #d66a2f;
  border-radius: 50%;
  font-size: 38rpx;
  font-weight: 800;
}

.demo-panel {
  margin-top: 34rpx;
  padding: 22rpx;
  background: #f3f5f5;
  border: 2rpx solid #e7ebec;
  border-radius: 22rpx;
}

.demo-heading,
.persona-row {
  display: flex;
  align-items: center;
}

.demo-heading { justify-content: space-between; gap: 16rpx; }
.demo-title { color: #455a69; font-size: 25rpx; font-weight: 700; }
.demo-description { margin-top: 5rpx; color: #70818d; font-size: 22rpx; line-height: 1.4; }
.reset-button { flex: 0 0 auto; min-height: 72rpx; margin: 0; padding: 10rpx 20rpx; color: #536a78; background: #fff; border-radius: 999rpx; font-size: 23rpx; }
.persona-row { gap: 10rpx; margin-top: 18rpx; }
.persona-button { flex: 1; min-height: 76rpx; margin: 0; padding: 10rpx 8rpx; color: #5c7281; background: #fff; border-radius: 16rpx; font-size: 22rpx; line-height: 1.3; }
.persona-button--active { color: #fff; background: #176c59; }

@media (max-width: 340px) {
  .profile-stage,
  .profile-stage-content { min-height: 480rpx; }
  .profile-stage-content { padding-right: 22rpx; padding-left: 22rpx; }
  .profile-action-row { right: 22rpx; min-height: 88rpx; }
  .profile-edit-button { min-width: 132rpx; min-height: 88rpx; }
  .profile-edit-surface { min-height: 48rpx; padding-right: 14rpx; padding-left: 14rpx; font-size: 20rpx; }
  .profile-identity { margin-top: 86rpx; }
  .profile-avatar-shell { flex-basis: 112rpx; width: 112rpx; height: 112rpx; }
  .profile-name-block { margin-left: 18rpx; }
  .profile-name { max-width: 250rpx; font-size: 32rpx; }
  .profile-verification { font-size: 18rpx; }
  .profile-intro { min-height: 66rpx; margin-top: 15rpx; font-size: 22rpx; }
  .profile-metrics { min-height: 98rpx; }
  .metric-value { font-size: 32rpx; }
  .metric-label { font-size: 20rpx; }
  .quick-task-card { width: 292rpx; }
  .profile-content-sheet { margin-top: -32rpx; padding-right: 20rpx; padding-left: 20rpx; border-radius: 28rpx 28rpx 0 0; }
  .list-tab { font-size: 23rpx; }
  .list-tab--active { font-size: 25rpx; }
  .tab-count { min-width: 24rpx; padding-right: 5rpx; padding-left: 5rpx; font-size: 17rpx; }
  .timeline-heading { flex-wrap: wrap; gap: 6rpx 10rpx; }
  .timeline-summary { order: 3; flex-basis: 100%; padding-left: 2rpx; }
  .timeline-capacity { margin-left: auto; }
  .timeline-track { top: 92rpx; }
  .timeline-activity { min-height: 194rpx; margin-left: 32rpx; gap: 14rpx; }
  .timeline-cover { flex-basis: 136rpx; width: 136rpx; height: 170rpx; }
  .timeline-title { font-size: 25rpx; }
  .timeline-meta { font-size: 19rpx; }
  .timeline-tags status-badge { display: none; }
  .persona-row { flex-wrap: wrap; }
  .persona-button { flex: 1 1 190rpx; }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton-shimmer { animation: none; }
  .timeline-activity,
  .metric-item,
  .profile-edit-button,
  .profile-intro { transition: none; }
}

/* 下方面板独立视觉：不改变上方背景、资料、待办与页面状态。 */
.profile-content-sheet { background: #f9f7f2; box-shadow: 0 -4rpx 16rpx rgba(15,23,42,0.03); }
.profile-content-sheet .list-tabs { height: auto; min-height: 104rpx; border-color: #efece6; }
.profile-content-sheet .list-tab { flex-wrap: wrap; min-height: 44px; padding: 16rpx 4rpx 20rpx; color: #78716c; font-size: 28rpx; gap: 6rpx; white-space: normal; }
.profile-content-sheet .list-tab--active { color: #111827; font-size: 28rpx; }
.profile-content-sheet .list-tab--active::before { background: #f59e0b; transform: translateX(-50%); }
.profile-content-sheet .tab-count { max-width: 100%; font-size: 24rpx; color: #57534e; background: #eeeae2; overflow-wrap: anywhere; }
.profile-content-sheet .list-tab--active .tab-count { color: #92400e; background: #fef3c7; }
.profile-content-sheet .timeline-heading { flex-wrap: wrap; min-height: 54rpx; }
.profile-content-sheet .timeline-date { flex-wrap: wrap; font-size: 28rpx; }
.profile-content-sheet .timeline-weekday { color: #78716c; font-size: 24rpx; }
.profile-content-sheet .timeline-track { top: 70rpx; background: repeating-linear-gradient(to bottom,#ded8ce 0,#ded8ce 8rpx,transparent 8rpx,transparent 15rpx); pointer-events: none; }
.profile-content-sheet .timeline-dot { background: #f59e0b; border-color: #fef3c7; }
.profile-content-sheet .timeline-activity { padding: 20rpx; align-items: flex-start; gap: 18rpx; background: #fff; border: 1.5rpx solid #efece6; border-radius: 24rpx; box-shadow: 0 4rpx 14rpx rgba(15,23,42,0.04); }
.profile-content-sheet .timeline-cover { flex-basis: 120rpx; width: 120rpx; height: 150rpx; border-radius: 16rpx; }
.profile-content-sheet .timeline-tags { flex-wrap: wrap; justify-content: flex-start; }
.profile-content-sheet .timeline-type { max-width: 100%; font-size: 24rpx; line-height: 1.4; overflow-wrap: anywhere; }
.profile-content-sheet .timeline-title { font-size: 28rpx; }
.profile-content-sheet .timeline-archive { color: #78716c; font-size: 24rpx; }
.profile-content-sheet .timeline-meta { align-items: flex-start; overflow: visible; color: #78716c; font-size: 24rpx; line-height: 1.5; white-space: normal; }
.profile-content-sheet .timeline-meta > text:last-child { flex: 1; min-width: 0; overflow-wrap: anywhere; word-break: break-all; white-space: normal; }
.profile-content-sheet .timeline-card-footer { display: flex; flex-direction: column; gap: 8rpx; margin-top: 16rpx; padding-top: 12rpx; border-top: 1rpx solid #efece6; }
.profile-content-sheet .timeline-summary { flex: initial; flex-basis: auto; flex-wrap: wrap; order: initial; padding-left: 0; overflow: visible; font-size: 24rpx; line-height: 1.5; color: #78716c; white-space: normal; }
.profile-content-sheet .timeline-summary > text { min-width: 0; overflow-wrap: anywhere; }
.profile-content-sheet .timeline-capacity { display: flex; flex-wrap: wrap; align-items: center; gap: 8rpx; margin-left: 0; color: #57534e; font-size: 24rpx; line-height: 1.5; white-space: normal; overflow-wrap: anywhere; }
.profile-content-sheet .sheet-status { max-width: 100%; padding: 4rpx 10rpx; color: #57534e; background: #eeeae2; border-radius: 12rpx; }
.profile-content-sheet .sheet-status--success { color: #11784f; background: #e5f6ed; }
.profile-content-sheet .sheet-status--info { color: #275fc3; background: #eaf1ff; }
.profile-content-sheet .sheet-status--danger { color: #b4232a; background: #ffe9ea; }
.profile-content-sheet .list-empty { margin-top: 4rpx; padding: 48rpx 28rpx; background: #fff; border: 1.5rpx solid #efece6; border-radius: 24rpx; }
.profile-content-sheet .empty-title { color: #111827; font-size: 30rpx; }
.profile-content-sheet .empty-copy { color: #78716c; font-size: 24rpx; }
.profile-content-sheet .empty-action { min-height: 44px; max-width: 100%; color: #fff; background: #111827; font-size: 28rpx; }
.profile-content-sheet .empty-puzzle { background: #e0f2fe; border-color: #075985; pointer-events: none; user-select: none; }
.profile-content-sheet .empty-puzzle::before { background: #e0f2fe; border-color: #075985; }
@media (max-width: 340px) {
  .profile-content-sheet .list-tab { flex-direction: column; flex-wrap: nowrap; }
  .profile-content-sheet .timeline-activity { margin-left: 24rpx; padding: 16rpx; gap: 12rpx; border-radius: 20rpx; }
  .profile-content-sheet .timeline-cover { flex-basis: 104rpx; width: 104rpx; height: 130rpx; }
}
```

FILE: pages/user/index.json
```
{
  "navigationStyle": "custom",
  "navigationBarTextStyle": "white",
  "backgroundColor": "#075AA7",
  "backgroundColorTop": "#075AA7",
  "backgroundColorBottom": "#F9F7F2",
  "backgroundTextStyle": "light",
  "usingComponents": {
    "status-badge": "/components/status-badge/index"
  }
}
```
</GEMINI_WEB_PROMPT>
