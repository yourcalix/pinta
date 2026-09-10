<GEMINI_WEB_PROMPT>
ROLE: frontend implementation reviewer

审查拼吧微信原生小程序“消息”主页向首页暖米白风格更新的实际实现。你此前给出APPROVE_PLAN。本次包含完整WXML/WXSS/JSON和未修改的JS。

首页参考：#F9F7F2背景、#111827主字、#78716C辅助字、白色圆角卡、暖灰细边框、轻阴影、小面积淡橙浅蓝。
采纳：紧凑标题区、浅橙通知卡、白色会话卡、淡色深字头像、200rpx+安全区留白。来源活动保持独立辅助行；<=340px时间另起一行。消息摘要单行省略，卡片min-height允许增高。
差异理由：正文>=28rpx、辅助>=24rpx，不使用你参数表中的小字和固定卡高。不增加语音/在线状态/已读回执/新路由。系统通知无数据时明确通往“我的”，延续原行为；不隐藏入口也不伪称“暂无新通知”。JS业务代码未修改。
共享app.wxss对view/text/button等设置box-sizing:border-box；TabBar高度116rpx，bottom:calc(24rpx + env(safe-area-inset-bottom))，左右24rpx。顶端由原有calculateContentTopInset计算。页面保留自然滚动、下拉刷新与20条分页。
测试：371通过、0失败、1跳过；项目结构/语法检查ok。尚无本次真机截图，不可宣称已验证真机效果。

请重点审查：320px/375px和大字下元数据宽度与换行、通知真实跳转语义、loading/empty/error与分页覆盖、ARIA聚合、局部背景与TabBar安全区。以本次差异为主要范围，历史JS问题请单列并明确不是本次引入。
输出Critical/Warning/Info，每项附文件与最小修复建议，最后APPROVE或REVISE。不要生成虚假业务事实或测试结论。

FILE: pages/messages/index.wxml
```
<view class="messages-page" style="padding-top: {{contentTopInset}}px;">
  <view class="messages-header">
    <view class="header-title-row"><text class="title" role="heading" aria-level="1">消息</text><text class="eyebrow" aria-hidden="true">PINBA MESSAGES</text></view>
    <text class="subtitle">和搭子保持联系</text>
  </view>

  <view class="messages-content">
    <view class="system-card {{!systemNotification ? 'system-card--quiet' : ''}}" bindtap="handleSystemNotification" hover-class="paper-card--pressed" role="button" aria-label="{{systemNotification ? '系统通知：' + systemNotification.title + '，' + systemUnread + '条未读，点击查看该通知' : '系统通知，前往我的页面查看活动进度'}}">
      <view class="system-icon" aria-hidden="true"><image src="/assets/icons/home/header-bell.png" mode="aspectFit" /></view>
      <view class="system-copy" aria-hidden="true">
        <view class="system-title-row"><text class="system-title">系统通知</text><text wx:if="{{systemUnread}}" class="system-count">{{systemUnread > 99 ? '99+' : systemUnread}}</text></view>
        <text class="system-preview">{{systemNotification ? systemNotification.title : '前往“我的”查看活动进度'}}</text>
      </view>
      <text class="chevron" aria-hidden="true">›</text>
    </view>

    <view class="section-heading" role="heading" aria-level="2"><text>全部私信</text></view>

    <block wx:if="{{loading}}">
      <view role="status" aria-label="正在加载私信"><view wx:for="{{[1,2,3]}}" wx:key="*this" class="conversation-card skeleton-card" aria-hidden="true"><view class="skeleton-avatar"></view><view class="skeleton-lines"><view></view><view></view></view></view></view>
    </block>

    <view wx:elif="{{error}}" class="state-paper" role="alert">
      <view class="state-bubble" aria-hidden="true">…</view>
      <text class="state-title">消息暂时走丢了</text>
      <text class="state-desc">{{error}}</text>
      <button class="state-action" hover-class="paper-card--pressed" bindtap="handleRetry">重新加载</button>
    </view>

    <view wx:elif="{{!conversations.length}}" class="state-paper">
      <view class="state-bubble" aria-hidden="true">♡</view>
      <text class="state-title">暂无私信</text>
      <text class="state-desc">加入并成团后，可在成员空间与搭子开始一对一沟通。</text>
    </view>

    <view wx:else class="conversation-list">
      <view
        wx:for="{{conversations}}"
        wx:key="id"
        class="conversation-card"
        data-id="{{item.id}}"
        bindtap="handleConversation"
        hover-class="paper-card--pressed"
        role="button"
        aria-label="{{item.accessibilityLabel}}，{{item.displayTime}}{{item.source && item.source.title ? '，来自活动：' + item.source.title : ''}}"
      >
        <view class="conversation-avatar avatar--{{item.tone}}" aria-hidden="true">{{item.initial}}</view>
        <view class="conversation-copy" aria-hidden="true">
          <view class="conversation-top"><text class="conversation-name">{{item.nickname}}</text><text class="conversation-time">{{item.displayTime}}</text></view>
          <view class="conversation-bottom"><text class="conversation-preview">{{item.preview}}</text><text wx:if="{{item.unreadCount}}" class="conversation-unread">{{item.unreadCount > 99 ? '99+' : item.unreadCount}}</text></view>
          <text wx:if="{{item.source && item.source.title}}" class="source-label">来自活动：{{item.source.title}}</text>
        </view>
      </view>
      <view class="list-footer" role="status">
        <text wx:if="{{loadingMore}}">正在加载更多…</text>
        <button wx:elif="{{loadMoreError}}" class="footer-retry" bindtap="handleRetryLoadMore">{{loadMoreError}}</button>
        <text wx:elif="{{!hasMore}}">已经到底啦</text>
      </view>
    </view>
  </view>
</view>
```


FILE: pages/messages/index.wxss
```
page { min-height: 100%; color: #111827; background: #f9f7f2; }
.messages-page { min-height: 100vh; padding-bottom: calc(200rpx + env(safe-area-inset-bottom)); background: #f9f7f2; }
.messages-header { padding: 8rpx 28rpx 20rpx; }
.header-title-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8rpx 16rpx; }
.title { font-size: 36rpx; line-height: 1.2; font-weight: 800; }
.eyebrow { color: #92400e; font-size: 24rpx; line-height: 1.3; letter-spacing: 1rpx; }
.subtitle { display: block; margin-top: 4rpx; color: #78716c; font-size: 24rpx; line-height: 1.4; }
.messages-content { padding: 0 28rpx; }
.system-card, .conversation-card, .state-paper { border: 1.5rpx solid #efece6; border-radius: 24rpx; background: #fff; box-shadow: 0 4rpx 14rpx rgba(15,23,42,0.04); }
.paper-card--pressed { opacity: 0.76; }
.system-card { display: flex; align-items: center; min-height: 120rpx; padding: 16rpx 24rpx; border-color: #fde68a; border-radius: 28rpx; background: linear-gradient(135deg,#fffdf8,#fef3c7); box-shadow: 0 6rpx 18rpx rgba(245,158,11,0.08); }
.system-card--quiet { background: #f5f1e9; border-color: #e7e1d7; box-shadow: none; }
.system-icon { display: flex; flex: 0 0 56rpx; width: 56rpx; height: 56rpx; align-items: center; justify-content: center; border-radius: 50%; background: #fde9ae; pointer-events: none; user-select: none; }
.system-icon image { width: 32rpx; height: 32rpx; }
.system-copy { flex: 1; min-width: 0; margin-left: 16rpx; }
.system-title-row { display: flex; align-items: center; gap: 10rpx; }
.system-title { color: #78350f; font-size: 28rpx; line-height: 1.35; font-weight: 700; }
.system-count, .conversation-unread { flex: 0 0 auto; min-width: 36rpx; padding: 2rpx 10rpx; border-radius: 22rpx; color: #fff; background: #c93732; font-size: 24rpx; line-height: 1.35; font-weight: 700; text-align: center; }
.system-preview { display: block; margin-top: 4rpx; overflow: hidden; color: #92400e; font-size: 24rpx; line-height: 1.4; white-space: nowrap; text-overflow: ellipsis; }
.chevron { flex: 0 0 auto; margin-left: 12rpx; color: #78716c; font-size: 28rpx; pointer-events: none; user-select: none; }
.section-heading { display: flex; align-items: center; min-height: 72rpx; padding: 12rpx 2rpx; font-size: 28rpx; line-height: 1.4; font-weight: 800; }
.conversation-list { display: grid; gap: 16rpx; }
.conversation-card { display: flex; align-items: flex-start; min-width: 0; min-height: 148rpx; padding: 20rpx; }
.conversation-avatar, .skeleton-avatar { flex: 0 0 80rpx; width: 80rpx; height: 80rpx; border-radius: 50%; font-size: 34rpx; line-height: 80rpx; font-weight: 700; text-align: center; }
.avatar--blue { color: #1e40af; background: #e5edfc; }
.avatar--purple { color: #6b21a8; background: #f0e7f8; }
.avatar--orange { color: #9a3412; background: #fcebdc; }
.avatar--green { color: #166534; background: #e4f1e5; }
.avatar--teal { color: #115e59; background: #ddf1ee; }
.conversation-copy { flex: 1; min-width: 0; margin-left: 18rpx; }
.conversation-top { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4rpx 12rpx; }
.conversation-name { flex: 1 1 160rpx; min-width: 0; overflow: hidden; font-size: 28rpx; line-height: 1.4; font-weight: 700; white-space: nowrap; text-overflow: ellipsis; }
.conversation-time { flex: 0 1 auto; max-width: 100%; color: #78716c; font-size: 24rpx; line-height: 1.4; overflow-wrap: anywhere; }
.conversation-bottom { display: flex; align-items: center; min-width: 0; gap: 12rpx; margin-top: 6rpx; }
.conversation-preview { flex: 1; min-width: 0; overflow: hidden; color: #57534e; font-size: 28rpx; line-height: 1.4; white-space: nowrap; text-overflow: ellipsis; }
.source-label { display: block; max-width: 100%; margin-top: 8rpx; padding: 2rpx 8rpx; overflow: hidden; border-radius: 8rpx; color: #57534e; background: #f5f4f1; font-size: 24rpx; line-height: 1.4; white-space: nowrap; text-overflow: ellipsis; }
.state-paper { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 320rpx; padding: 40rpx 28rpx; text-align: center; }
.state-bubble { width: 80rpx; height: 64rpx; border: 3rpx solid #b4cde0; border-radius: 24rpx 24rpx 24rpx 8rpx; color: #075985; background: #edf7fc; font-size: 36rpx; line-height: 56rpx; transform: rotate(-6deg); pointer-events: none; user-select: none; }
.state-title { margin-top: 24rpx; font-size: 30rpx; line-height: 1.4; font-weight: 800; }
.state-desc { max-width: 500rpx; margin-top: 12rpx; color: #78716c; font-size: 24rpx; line-height: 1.5; overflow-wrap: anywhere; }
.state-action, .footer-retry { display: flex; align-items: center; justify-content: center; min-height: 88rpx; min-height: max(88rpx,44px); max-width: 100%; margin-top: 24rpx; padding: 16rpx 32rpx; border: 0; border-radius: 44rpx; color: #fff; background: #111827; font-size: 28rpx; line-height: 1.4; font-weight: 600; }
.state-action::after, .footer-retry::after { display: none; }
.list-footer { display: flex; justify-content: center; align-items: center; min-height: 88rpx; color: #78716c; font-size: 24rpx; line-height: 1.5; text-align: center; }
.footer-retry { margin: 0; color: #111827; background: #eeeae2; }
.skeleton-card { align-items: center; margin-bottom: 16rpx; }
.skeleton-avatar, .skeleton-lines view { background: #ece8e1; animation: pulse 1.5s ease-in-out infinite; }
.skeleton-lines { flex: 1; min-width: 0; margin-left: 18rpx; }
.skeleton-lines view { width: 58%; height: 24rpx; border-radius: 12rpx; }
.skeleton-lines view + view { width: 88%; margin-top: 16rpx; }
@keyframes pulse { 50% { opacity: 0.48; } }
@media (max-width: 340px) {
  .messages-header { padding-right: 20rpx; padding-left: 20rpx; }
  .messages-content { padding-right: 20rpx; padding-left: 20rpx; }
  .system-card { padding: 14rpx 18rpx; border-radius: 22rpx; }
  .conversation-list { gap: 12rpx; }
  .conversation-card { padding: 16rpx; border-radius: 20rpx; }
  .conversation-avatar, .skeleton-avatar { flex-basis: 72rpx; width: 72rpx; height: 72rpx; line-height: 72rpx; }
  .conversation-time { flex-basis: 100%; }
}
@media (prefers-reduced-motion: reduce) { .skeleton-avatar, .skeleton-lines view { animation: none; } }
```


FILE: pages/messages/index.json
```
{
  "navigationStyle": "custom",
  "navigationBarTextStyle": "black",
  "enablePullDownRefresh": true,
  "backgroundColor": "#F9F7F2",
  "backgroundColorTop": "#F9F7F2",
  "backgroundColorBottom": "#F9F7F2",
  "backgroundTextStyle": "dark"
}
```


FILE: pages/messages/index.js
```
'use strict';

const directMessageService = require('../../services/direct-message');
const userService = require('../../services/user');
const notificationRouter = require('../../services/notification-router');
const { formatDateTime } = require('../../utils/date');
const { calculateContentTopInset } = require('../../utils/navigation-layout');
const { selectTab, refreshUnread } = require('../../utils/tab-bar');

const PAGE_SIZE = 20;
const TONES = ['blue', 'purple', 'orange', 'green', 'teal'];

function decorateConversation(item) {
  const nickname = String(item.peer && item.peer.nickname || '拼吧用户').trim() || '拼吧用户';
  const initial = Array.from(nickname)[0] || '拼';
  return {
    ...item,
    nickname,
    initial,
    tone: TONES[(initial.codePointAt(0) || 0) % TONES.length],
    preview: item.lastMessage ? `${item.lastMessage.isMine ? '我：' : ''}${item.lastMessage.preview}` : '从活动成员空间开始聊聊吧',
    displayTime: item.lastMessage ? formatDateTime(item.lastMessage.createdAt) : '',
    accessibilityLabel: `${nickname}的私信，${item.unreadCount ? `${item.unreadCount}条未读，` : ''}${item.lastMessage ? item.lastMessage.preview : '暂无消息'}，双击进入`
  };
}

Page({
  data: {
    contentTopInset: 88,
    conversations: [],
    nextCursor: '',
    hasMore: true,
    loading: true,
    loadingMore: false,
    loadMoreError: '',
    error: '',
    systemNotification: null,
    systemUnread: 0
  },

  onLoad() {
    this.setData({ contentTopInset: calculateContentTopInset(typeof wx === 'undefined' ? null : wx) });
  },

  onShow() {
    selectTab(this, 3);
    return this.loadPage(false, this.data.conversations.length > 0);
  },

  onHide() { this._loadSeq = (this._loadSeq || 0) + 1; },
  onUnload() { this._loadSeq = (this._loadSeq || 0) + 1; },

  async onPullDownRefresh() {
    try { await this.loadPage(false, true); } finally { wx.stopPullDownRefresh(); }
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading && !this.data.loadingMore && !this.data.loadMoreError) this.loadPage(true);
  },

  async loadPage(append = false, keepContent = false) {
    if (append && (!this.data.nextCursor || this.data.loadingMore)) return;
    const seq = append ? (this._loadSeq || 0) : (this._loadSeq = (this._loadSeq || 0) + 1);
    this.setData(append
      ? { loadingMore: true, loadMoreError: '' }
      : { loading: !keepContent, loadingMore: false, error: '', loadMoreError: '', ...(keepContent ? {} : { conversations: [] }) });
    try {
      await userService.login();
      if (seq !== this._loadSeq) return;
      const [conversationResult, notificationResult] = await Promise.allSettled([
        directMessageService.listConversations(append ? this.data.nextCursor : undefined, PAGE_SIZE),
        append ? Promise.resolve(null) : userService.notifications()
      ]);
      if (conversationResult.status === 'rejected') throw conversationResult.reason;
      if (notificationResult.status === 'rejected' && notificationResult.reason && notificationResult.reason.handled) throw notificationResult.reason;
      if (seq !== this._loadSeq) return;
      const result = conversationResult.value || { items: [] };
      const incoming = (result.items || []).map(decorateConversation);
      const notifications = notificationResult.status === 'fulfilled' && notificationResult.value
        ? notificationResult.value.items || []
        : [];
      const unreadNotifications = notifications.filter((item) => !item.read);
      this.setData({
        conversations: append ? [...new Map([...this.data.conversations, ...incoming].map((item) => [item.id, item])).values()] : incoming,
        nextCursor: result.nextCursor || '',
        hasMore: Boolean(result.nextCursor),
        loading: false,
        loadingMore: false,
        loadMoreError: '',
        error: '',
        ...(append ? {} : {
          systemNotification: unreadNotifications[0] || notifications[0] || null,
          systemUnread: unreadNotifications.length
        })
      });
      refreshUnread(this);
    } catch (error) {
      if (seq !== this._loadSeq) return;
      if (error && ['ACCOUNT_DISABLED', 'PROFILE_INCOMPLETE', 'UNAUTHENTICATED', 'FORBIDDEN'].includes(error.code)) {
        this.setData({ loading: false, loadingMore: false, conversations: [], nextCursor: '', hasMore: false, systemNotification: null, systemUnread: 0,
          error: error.code === 'PROFILE_INCOMPLETE' ? '请先到“我的”完善成年资料，再使用私信' : '账号暂时无法使用' });
        refreshUnread(this);
        return;
      }
      if (append) return this.setData({ loadingMore: false, loadMoreError: '加载更多失败，点击重试' });
      if (keepContent && this.data.conversations.length) {
        this.setData({ loading: false, loadingMore: false });
        return;
      }
      this.setData({
        loading: false,
        loadingMore: false,
        error: error && error.handled ? '账号暂时无法使用' : '网络连接较慢或服务开小差了，请重试'
      });
    }
  },

  handleConversation(event) {
    const id = event.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/subpackages/message/chat/index?id=${encodeURIComponent(id)}` });
  },

  async handleSystemNotification() {
    const item = this.data.systemNotification;
    if (!item) return wx.switchTab({ url: '/pages/user/index' });
    try { if (!item.read) await userService.readNotification(item.id); } catch (error) { if (error.handled) return; }
    const url = notificationRouter.resolveNotificationPath(item);
    if (url === '/pages/discover/index') return wx.switchTab({ url });
    wx.navigateTo({ url });
  },

  handleRetry() { this.loadPage(false); },
  handleRetryLoadMore() { this.loadPage(true); }
});
```

</GEMINI_WEB_PROMPT>
