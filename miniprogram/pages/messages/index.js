'use strict';

const communityService = require('../../services/community');
const directMessageService = require('../../services/direct-message');
const userService = require('../../services/user');
const notificationRouter = require('../../services/notification-router');
const { formatDateTime } = require('../../utils/date');
const { calculateContentTopInset } = require('../../utils/navigation-layout');
const { avatarPathFromKind } = require('../../utils/passenger-avatar');
const { selectTab, refreshUnread } = require('../../utils/tab-bar');

const PAGE_SIZE = 20;
const ACTIVITY_NOTIFICATION_TYPES = new Set([
  'NEW_APPLICATION',
  'APPLICATION_APPROVED',
  'APPLICATION_CLOSED',
  'APPLICATION_REJECTED',
  'GROUP_FORMED'
]);
const ENTRY_META = Object.freeze([
  { category: 'discussion', icon: '/assets/images/messages/icon-discussion-bubble-3d.png', title: '讨论动态', subtitle: '有人回复了你的内容' },
  { category: 'activity', icon: '/assets/images/messages/icon-activity-tent-3d.png', title: '活动通知', subtitle: '发现更多有趣的线下活动' },
  { category: 'system', icon: '/assets/images/community/community-notification-bell.png', title: '系统通知', subtitle: '账号与社区重要消息' }
]);

function classifyNotification(item) {
  return item && item.activityId && ACTIVITY_NOTIFICATION_TYPES.has(item.type) ? 'activity' : 'system';
}

function firstUnreadOrLatest(items) {
  return items.find((item) => item.read !== true) || items[0] || null;
}

function buildMessageEntries(state) {
  return ENTRY_META.map((item) => {
    const count = item.category === 'activity' ? state.activityUnread : item.category === 'system' ? state.systemUnread : 0;
    const hasUnread = item.category === 'discussion' ? state.discussionHasUnread : count > 0;
    return { ...item, hasUnread, accessibilityLabel: `${item.title}${count ? `，有${count}条未读` : hasUnread ? '，有未读动态' : ''}，${item.subtitle}，双击进入` };
  });
}

function decorateConversation(item) {
  const nickname = String(item.peer && item.peer.nickname || '拼吧用户').trim() || '拼吧用户';
  const initial = Array.from(nickname)[0] || '拼';
  const preview = item.lastMessage
    ? `${item.lastMessage.isMine ? '我：' : ''}${item.lastMessage.preview}`
    : '从活动成员空间开始聊聊吧';
  return {
    ...item,
    nickname,
    initial,
    avatarSrc: avatarPathFromKind(item.peer && item.peer.avatarKind),
    preview,
    displayTime: item.lastMessage ? formatDateTime(item.lastMessage.createdAt) : '',
    accessibilityLabel: `${nickname}的私信，${item.unreadCount ? `${item.unreadCount}条未读，` : ''}${preview}，双击进入`
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
    messageEntries: buildMessageEntries({ discussionHasUnread: false, activityUnread: 0, systemUnread: 0 }),
    discussionHasUnread: false,
    activityNotification: null,
    activityUnread: 0,
    systemNotification: null,
    systemUnread: 0
  },

  onLoad() {
    this.setData({ contentTopInset: calculateContentTopInset(typeof wx === 'undefined' ? null : wx) });
  },

  onShow() {
    this._navigationPending = false;
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
      const [conversationResult, notificationResult, discussionResult] = await Promise.allSettled([
        directMessageService.listConversations(append ? this.data.nextCursor : undefined, PAGE_SIZE),
        append ? Promise.resolve(null) : userService.notifications(),
        append ? Promise.resolve(null) : communityService.listActivities({ tab: 'ALL', limit: PAGE_SIZE })
      ]);
      if (conversationResult.status === 'rejected') throw conversationResult.reason;
      if (seq !== this._loadSeq) return;

      const result = conversationResult.value || { items: [] };
      const incoming = (result.items || []).map(decorateConversation);
      const nextData = {
        conversations: append ? [...new Map([...this.data.conversations, ...incoming].map((item) => [item.id, item])).values()] : incoming,
        nextCursor: result.nextCursor || '',
        hasMore: Boolean(result.nextCursor),
        loading: false,
        loadingMore: false,
        loadMoreError: '',
        error: ''
      };

      if (!append && notificationResult.status === 'fulfilled' && notificationResult.value) {
        const notifications = Array.isArray(notificationResult.value.items) ? notificationResult.value.items : [];
        const activityNotifications = notifications.filter((item) => classifyNotification(item) === 'activity');
        const systemNotifications = notifications.filter((item) => classifyNotification(item) === 'system');
        Object.assign(nextData, {
          activityNotification: firstUnreadOrLatest(activityNotifications),
          activityUnread: activityNotifications.filter((item) => item.read !== true).length,
          systemNotification: firstUnreadOrLatest(systemNotifications),
          systemUnread: systemNotifications.filter((item) => item.read !== true).length
        });
      }
      if (!append && discussionResult.status === 'fulfilled' && discussionResult.value) {
        const activities = Array.isArray(discussionResult.value.items) ? discussionResult.value.items : [];
        nextData.discussionHasUnread = activities.some((item) => item.read !== true);
      }
      if (!append) nextData.messageEntries = buildMessageEntries({ ...this.data, ...nextData });

      this.setData(nextData);
      refreshUnread(this);
    } catch (error) {
      if (seq !== this._loadSeq) return;
      if (error && ['ACCOUNT_DISABLED', 'PROFILE_INCOMPLETE', 'UNAUTHENTICATED', 'FORBIDDEN'].includes(error.code)) {
        this.setData({
          loading: false,
          loadingMore: false,
          conversations: [],
          nextCursor: '',
          hasMore: false,
          error: error.code === 'PROFILE_INCOMPLETE' ? '请先到“我的”完善成年资料，再使用私信' : '账号暂时无法使用'
        });
        refreshUnread(this);
        return;
      }
      if (append) return void this.setData({ loadingMore: false, loadMoreError: '加载更多失败，点击重试' });
      if (keepContent && this.data.conversations.length) return void this.setData({ loading: false, loadingMore: false });
      this.setData({
        loading: false,
        loadingMore: false,
        error: error && error.handled ? '账号暂时无法使用' : '网络连接较慢或服务开小差了，请重试'
      });
    }
  },

  _navigate(url) {
    if (!url || this._navigationPending) return;
    this._navigationPending = true;
    const fail = () => { this._navigationPending = false; };
    if (url.startsWith('/pages/')) return wx.switchTab({ url, fail });
    return wx.navigateTo({ url, fail });
  },

  async _openNotification(item, fallbackUrl) {
    if (this._navigationPending) return;
    if (!item) return this._navigate(fallbackUrl);
    try {
      if (!item.read) await userService.readNotification(item.id);
    } catch (error) {
      if (error && error.handled) return;
    }
    this._navigate(notificationRouter.resolveNotificationPath(item));
  },

  handleMessageEntry(event) {
    const category = String(event.currentTarget.dataset.category || '');
    if (category === 'discussion') return this._navigate('/subpackages/community/activity/index');
    if (category === 'activity') return this._openNotification(this.data.activityNotification, '/subpackages/activity/list/index');
    if (category === 'system') return this._openNotification(this.data.systemNotification, '/pages/user/index');
  },

  handleConversation(event) {
    const id = String(event.currentTarget.dataset.id || '');
    if (id) this._navigate(`/subpackages/message/chat/index?id=${encodeURIComponent(id)}`);
  },

  handleRetry() { this.loadPage(false); },
  handleRetryLoadMore() { this.loadPage(true); }
});

module.exports = { ACTIVITY_NOTIFICATION_TYPES, buildMessageEntries, classifyNotification, decorateConversation };
