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
