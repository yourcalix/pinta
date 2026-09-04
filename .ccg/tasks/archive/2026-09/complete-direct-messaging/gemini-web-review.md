<GEMINI_WEB_PROMPT>
ROLE: 拼吧微信小程序前端交互代码 reviewer（网页版 Gemini 3.7 Flash）

任务：用户明确要求“界面先保持这样，先完善补齐私信功能”。以下是真实当前代码，不是设计提案；请审查功能时序，不再重设计界面。你此前关于串行低频轮询、保留历史、同正文重试、贴底滚动和离屏清理的建议已综合实施。

范围与约束：
1. 保持现有背景、气泡、导航、输入底栏不变。WXSS 没有修改，WXML 仅新增 scroll 事件绑定。
2. 当前可发送聊天页请求结束后约 8 秒轮询；无后台推送、在线状态、已读回执、媒体、陌生人聊天。历史按20条分页，最新批次跨页追赶到上次服务端快照并按ID合并。
3. 阅读历史时不强制跳底、不标记未见新消息；回到底部才请求条件已读。ID不透明；服务端只在 lastMessageId 精确相等时清零。会话 latest ID 与同毫秒消息的排序首项未必相同，因此只有正文实际拉取后才可确认会话 latest ID。
4. 同正文失败重试复用当前页内clientMessageId；不把私信正文持久化；销毁页面后如需重发，应先核对历史。晚到响应不得清空新编辑的下一条草稿。
5. 活动结束、成员退出、对方账号停用时旧历史可查看，不能新发送；当前账号停用/无权限则清空受保护数据并作废在途响应。后端发送事务重新验证双方成员、账号和活动状态。
6. 后端已接受的消息重试先鉴权再重放，不重复审核/限流/累加未读；同ID不同payload冲突。两个原生账号才可验证真实收发。
7. api.getActorScope在Mock返回persona命名空间，在Cloud返回最近登录得到的会话作用域；账号停用由全局请求层清空作用域和globalData.user，继续抛出handled错误。所有服务都是api.invoke，无Cloud失败自动回退Mock。tab-bar确认快照仅在内存，换身份重置。
8. 以下代码中的wx/页面生命周期由微信宿主管理。消息列表按createdAt+ID降序返回；decorate后按正序展示。onShow负责首次请求，onLoad仅初始化参数。

已有本地证据：同步/重试/跨页追赶/生命周期/权限失效/条件已读/未读快照隔离/Cloud模拟查询事务/无Mock回退测试。GPT-5.5已完成两轮后端审查，确认的问题已修复。未部署真实云端，未做双真实账号或真机键盘测试，禁止据此宣称生产上线、恒定60fps或像素级通过。

请输出：
A. Critical / Warning / Info；确认bug给出文件、函数、可复现事件顺序和最小修复。
B. 核查fetch/read/send互相交错、连续onHide/onShow、旧已读在途时新候选到达、阅读历史/恢复贴底、发送失败编辑草稿、只读切换。
C. 区分已被代码/测试证实的结论与iOS/Android真机待验项；无截图不审查像素。
D. 若无阻断项明确“本地交互代码可交付，真实云与真机待验”，不要追加视觉或重型社交功能。

下面各文件为完整当前内容，无相关事件绑定或属性省略。

## miniprogram/subpackages/message/chat/index.js
```javascript
'use strict';

const directMessageService = require('../../../services/direct-message');
const { calculateContentTopInset } = require('../../../utils/navigation-layout');
const { decorateMessageList, getPeerIdentity, mergeMessages } = require('../../../utils/direct-message-view');
const { refreshUnread } = require('../../../utils/tab-bar');

const PAGE_SIZE = 20;
const POLL_MS = 8000;
const SOURCE_LABELS = Object.freeze({ companion: '拼同行', sport: '拼运动', food: '拼饭桌' });

function makeClientMessageId() {
  return `client_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function hideKeyboardSafely() {
  try {
    if (typeof wx !== 'undefined' && typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
  } catch (error) {
    // Keyboard cleanup must never block the read-only transition.
  }
}

Page({
  data: {
    contentTopInset: 88,
    id: '',
    conversation: null,
    messages: [],
    nextCursor: '',
    hasMore: true,
    loading: true,
    loadingOlder: false,
    olderError: '',
    error: '',
    text: '',
    sending: false,
    sendError: '',
    canSend: false,
    messagingAvailable: false,
    peerName: '私信',
    peerInitial: '拼',
    peerTone: 'green',
    sourceTypeLabel: '共同拼单',
    sourceTone: 'companion',
    scrollIntoView: '',
    scrollWithAnimation: false,
    quickPrompts: ['你好，想和你确认一下集合地点～', '关于活动时间想和你确认一下']
  },

  onLoad(options = {}) {
    this._loadSeq = 0;
    this._isNearBottom = true;
    this.setData({
      contentTopInset: calculateContentTopInset(typeof wx === 'undefined' ? null : wx),
      id: String(options.id || '').trim()
    });
  },

  onShow() {
    this._visible = true;
    this.setData({ sending: Boolean(this._sendToken), loadingOlder: false });
    this.measureScrollViewport();
    return this.data.conversation ? this.refreshLatest() : this.loadMessages(false);
  },

  onHide() {
    this._visible = false;
    this._loadSeq = (this._loadSeq || 0) + 1;
    this._fetchToken = null;
    this._readToken = null;
    this.stopPolling();
    if (this._focusScrollTimer) clearTimeout(this._focusScrollTimer);
    this._focusScrollTimer = null;
    hideKeyboardSafely();
  },

  onUnload() {
    this.onHide();
    this._failedDraft = null;
    this._disposed = true;
  },

  stopPolling() {
    if (this._pollTimer) clearTimeout(this._pollTimer);
    this._pollTimer = null;
  },

  schedulePolling() {
    this.stopPolling();
    if (!this._visible || this.data.error || !this.data.messagingAvailable) return;
    this._pollTimer = setTimeout(() => {
      this._pollTimer = null;
      this.refreshLatest();
    }, POLL_MS);
  },

  loadMessages(older) { return this.fetchMessages(older ? 'older' : 'initial'); },
  refreshLatest() { return this.fetchMessages('refresh'); },

  async fetchMessages(mode) {
    if (!this._visible || this._fetchToken) return;
    const older = mode === 'older';
    const refresh = mode === 'refresh';
    if (older && !this.data.nextCursor) return;
    const seq = this._loadSeq;
    if (!this.data.id) return this.setData({ loading: false, error: '会话不存在或已失效' });
    const token = {};
    this._fetchToken = token;
    this.stopPolling();
    if (!refresh) this.setData(older ? { loadingOlder: true, olderError: '' } : { loading: true, error: '', sendError: '' });
    const current = () => this._visible && seq === this._loadSeq && this._fetchToken === token;
    try {
      const result = await directMessageService.listMessages(this.data.id, older ? this.data.nextCursor : undefined, PAGE_SIZE);
      if (!current()) return;
      const conversation = result.conversation || {};
      const peer = getPeerIdentity(conversation.peer && conversation.peer.nickname);
      let incoming = result.items || [];
      const oldFirst = this.data.messages[0];
      const oldLast = this.data.messages[this.data.messages.length - 1];
      const boundaryId = this._syncedLastId || (oldLast && oldLast.id);
      let cursor = result.nextCursor;
      const visited = new Set();
      // Read backwards until the newest snapshot connects to the last fetched snapshot.
      // A locally sent message must not become the boundary and hide intervening peer messages.
      while (refresh && boundaryId && cursor && !incoming.some((item) => item.id === boundaryId)) {
        if (visited.has(cursor)) throw new Error('Repeated message cursor');
        visited.add(cursor);
        const page = await directMessageService.listMessages(this.data.id, cursor, PAGE_SIZE);
        if (!current()) return;
        incoming = incoming.concat(page.items || []);
        cursor = page.nextCursor;
        if (page.conversation && page.conversation.messagingAvailable === false) conversation.messagingAvailable = false;
      }
      const messages = decorateMessageList(mergeMessages(this.data.messages, incoming), peer.nickname);
      const messagingAvailable = conversation.messagingAvailable === true;
      const sourceType = conversation.source && conversation.source.activityType;
      if (this.data.messagingAvailable && !messagingAvailable) hideKeyboardSafely();
      if (!older) {
        this._syncedLastId = result.items && result.items[0] ? result.items[0].id : boundaryId;
        // Commit order may differ from ID sort order for equal timestamps.
        // Only acknowledge the conversation's latest ID if its body was fetched.
        const latestId = conversation.lastMessage && conversation.lastMessage.id;
        this._latestReadCandidate = latestId && incoming.some((item) => item.id === latestId) ? latestId : '';
      }
      await new Promise((resolve) => this.setData({
        conversation,
        messagingAvailable,
        canSend: messagingAvailable && Boolean(String(this.data.text || '').trim()),
        peerName: peer.nickname,
        peerInitial: peer.initial,
        peerTone: peer.tone,
        sourceTypeLabel: SOURCE_LABELS[sourceType] || '共同拼单',
        sourceTone: SOURCE_LABELS[sourceType] ? sourceType : 'companion',
        messages,
        ...(refresh && this.data.conversation ? {} : { nextCursor: result.nextCursor || '', hasMore: Boolean(result.nextCursor) }),
        loading: false,
        loadingOlder: false,
        olderError: '',
        error: '',
        scrollWithAnimation: false,
        scrollIntoView: older && oldFirst ? oldFirst.anchorId || '' : ''
      }, resolve));
      if (!current()) return;
      this.measureScrollViewport();
      if (!older && this._isNearBottom !== false) {
        if (!oldLast || messages[messages.length - 1]?.id !== oldLast.id) this.scrollToLatest(true);
        await this.markVisibleRead();
      }
    } catch (error) {
      if (!current()) return;
      if (this.handleAccessError(error)) return;
      if (refresh) return; // Transient poll failures never replace a usable chat.
      if (older) return this.setData({ loadingOlder: false, olderError: '更早消息加载失败，点击重试' });
      this.setData({
        loading: false,
        error: error && error.handled ? '账号暂时无法使用' : '私信暂时没有加载出来，请稍后重试'
      });
    } finally {
      if (this._fetchToken === token) {
        this._fetchToken = null;
        this.schedulePolling();
      }
    }
  },

  handleAccessError(error) {
    if (!error || !['ACCOUNT_DISABLED', 'NOT_FOUND_OR_NOT_ALLOWED', 'UNAUTHENTICATED', 'PROFILE_INCOMPLETE', 'FORBIDDEN'].includes(error.code)) return false;
    this._loadSeq = (this._loadSeq || 0) + 1;
    this._fetchToken = null;
    this._readToken = null;
    this._latestReadCandidate = '';
    this._syncedLastId = '';
    this._readAckId = '';
    this.stopPolling();
    this._failedDraft = null;
    hideKeyboardSafely();
    this.setData({ loading: false, loadingOlder: false, messages: [], conversation: null, text: '', canSend: false, messagingAvailable: false,
      error: error.code === 'PROFILE_INCOMPLETE' ? '请先到“我的”完善成年资料，再进入私信' : '会话不存在或当前不可访问' });
    return true;
  },

  async markVisibleRead() {
    const lastMessageId = this._latestReadCandidate;
    if (!this._visible || this._isNearBottom === false || !lastMessageId || this._readToken || this._readAckId === lastMessageId) return;
    const seq = this._loadSeq;
    const token = {};
    this._readToken = token;
    try {
      const result = await directMessageService.markRead(this.data.id, lastMessageId);
      if (!this._visible || seq !== this._loadSeq) return;
      if (result && result.unread === 0) this._readAckId = lastMessageId;
      await refreshUnread();
    } catch (error) {
      if (this._visible && seq === this._loadSeq) this.handleAccessError(error);
    } finally {
      if (this._readToken === token) {
        this._readToken = null;
        // Only a changed candidate gets an immediate follow-up. Retrying the same
        // failed candidate here would cause an unbounded network-error loop.
        if (this._visible && seq === this._loadSeq && this._isNearBottom !== false
          && this._latestReadCandidate && this._latestReadCandidate !== lastMessageId) this.markVisibleRead();
      }
    }
  },

  measureScrollViewport() {
    if (typeof this.createSelectorQuery !== 'function') return;
    this.createSelectorQuery().select('.message-scroll').boundingClientRect((rect) => {
      if (this._visible && rect) this._scrollViewportHeight = rect.height;
    }).exec();
  },

  handleScroll(event) {
    const { scrollHeight, scrollTop, deltaY } = event.detail || {};
    if (this._scrollViewportHeight > 0) this._isNearBottom = scrollHeight - scrollTop - this._scrollViewportHeight <= 150;
    else if (deltaY > 0) this._isNearBottom = false;
    if (this._isNearBottom) this.markVisibleRead();
  },

  handleScrollLower() {
    this._isNearBottom = true;
    this.markVisibleRead();
  },

  handleInput(event) {
    const text = event.detail.value;
    this._draftRevision = (this._draftRevision || 0) + 1;
    if (this._failedDraft && this._failedDraft.text !== String(text || '').trim()) this._failedDraft = null;
    this.setData({
      text,
      sendError: '',
      canSend: this.data.messagingAvailable && Boolean(String(text || '').trim())
    });
  },

  handleQuickPrompt(event) {
    const text = String(event.currentTarget.dataset.text || '').slice(0, 500);
    this.handleInput({ detail: { value: text } });
  },

  handleComposerFocus() {
    if (this._focusScrollTimer) clearTimeout(this._focusScrollTimer);
    this._focusScrollTimer = setTimeout(() => {
      this._focusScrollTimer = null;
      this.measureScrollViewport();
      if (this._visible && this._isNearBottom !== false) this.scrollToLatest(true);
    }, 50);
  },

  scrollToLatest(animated) {
    const last = this.data.messages[this.data.messages.length - 1];
    if (!last) return;
    this._isNearBottom = true;
    this.setData({ scrollIntoView: '', scrollWithAnimation: Boolean(animated) }, () => {
      if (this._visible) this.setData({ scrollIntoView: last.anchorId });
    });
  },

  async handleSend() {
    const text = String(this.data.text || '').trim();
    if (!this._visible || !text || this._sendToken || this.data.sending || !this.data.messagingAvailable) return;
    const draft = this._failedDraft && this._failedDraft.text === text ? this._failedDraft : { text, clientMessageId: makeClientMessageId() };
    this._failedDraft = draft;
    const token = {};
    this._sendToken = token;
    const seq = this._loadSeq;
    const revision = this._draftRevision;
    this.setData({ sending: true, sendError: '' });
    try {
      const result = await directMessageService.sendMessage(this.data.id, draft.clientMessageId, text);
      if (this._disposed) return;
      if (!this._visible || seq !== this._loadSeq) return;
      if (this._failedDraft === draft) this._failedDraft = null;
      const messages = decorateMessageList(mergeMessages(this.data.messages, [result.message]), this.data.peerName);
      this.setData({ messages, ...(revision === this._draftRevision ? { text: '', canSend: false } : {}), sending: false }, () => this.scrollToLatest(true));
      refreshUnread();
    } catch (error) {
      if (!this._visible || seq !== this._loadSeq || this.handleAccessError(error)) return;
      this.setData({ sendError: error && error.code === 'CONTENT_REJECTED' ? '内容未通过安全检查，请修改后重试' : '发送失败，内容已保留，请重试' });
      // CONFLICT can also mean an idempotency mismatch; only server availability may close input.
      if (error && error.code === 'CONFLICT') this.refreshLatest();
    } finally {
      if (this._sendToken === token) this._sendToken = null;
      if (this._visible && !this._disposed) this.setData({ sending: false });
    }
  },

  handleLoadOlder() { this.loadMessages(true); },
  handleRetry() { this.loadMessages(false); },

  handleBack() {
    let pages = [];
    try { pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []; } catch (error) { pages = []; }
    if (pages.length > 1) return wx.navigateBack({ delta: 1 });
    return wx.switchTab({ url: '/pages/messages/index' });
  },

  handleSource() {
    const source = this.data.conversation && this.data.conversation.source;
    if (!source || !source.id) return;
    wx.navigateTo({ url: `/subpackages/activity/detail/index?id=${encodeURIComponent(source.id)}` });
  },

  handleReport() {
    if (!this.data.id) return;
    wx.navigateTo({
      url: `/subpackages/safety/report/index?type=directConversation&id=${encodeURIComponent(this.data.id)}&from=chat`
    });
  }
});

```

## miniprogram/subpackages/message/chat/index.wxml
```xml
<view class="chat-page global-background-host" style="padding-top: {{contentTopInset}}px;">
  <image class="global-page-background" src="/assets/images/shared/shared-paper-bg.webp" mode="aspectFill" aria-hidden="true" />
  <view class="global-page-background-tint" aria-hidden="true"></view>

  <view class="chat-navigation" style="height: {{contentTopInset}}px;">
    <view class="chat-navigation-row">
      <button class="chat-back-button" bindtap="handleBack" hover-class="chat-nav-button--pressed" aria-label="返回消息列表"><view class="chat-back-chevron" aria-hidden="true"></view></button>
      <view class="chat-navigation-title" aria-label="正在和{{peerName}}私信">{{peerName}}</view>
    </view>
  </view>

  <view class="chat-shell">
    <view wx:if="{{loading}}" class="chat-state chat-state--loading" role="status" aria-label="正在打开私信">
      <view class="state-source-skeleton skeleton-shimmer"></view>
      <view class="state-bubble-skeleton state-bubble-skeleton--left skeleton-shimmer"></view>
      <view class="state-bubble-skeleton state-bubble-skeleton--right skeleton-shimmer"></view>
      <view class="state-bubble-skeleton state-bubble-skeleton--short skeleton-shimmer"></view>
    </view>
    <view wx:elif="{{error}}" class="chat-state" role="alert">
      <view class="state-chat-icon" aria-hidden="true"><view></view></view>
      <text class="state-title">私信加载失败</text>
      <text class="state-copy">{{error}}</text>
      <button class="state-action" bindtap="handleRetry" hover-class="paper-button--pressed">重新加载</button>
    </view>

    <block wx:else>
      <view class="source-strip">
        <button class="source-main" bindtap="handleSource" disabled="{{!conversation.source}}" hover-class="source-main--pressed" aria-label="来自{{sourceTypeLabel}}，{{conversation.source ? conversation.source.title : '一对一私信'}}，点击查看活动详情">
          <text class="source-tag source-tag--{{sourceTone}}">{{sourceTypeLabel}}</text>
          <text class="source-title">{{conversation.source ? conversation.source.title : '一对一私信'}}</text>
          <text class="source-arrow" aria-hidden="true">›</text>
        </button>
        <view class="source-divider" aria-hidden="true"></view>
        <button class="source-report" bindtap="handleReport" hover-class="source-report--pressed" aria-label="举报此私信会话"><text aria-hidden="true">!</text> 举报</button>
      </view>

      <scroll-view class="message-scroll" scroll-y="true" scroll-into-view="{{scrollIntoView}}" scroll-with-animation="{{scrollWithAnimation}}" enhanced="true" show-scrollbar="false" bindscroll="handleScroll" bindscrolltolower="handleScrollLower" lower-threshold="150">
        <view class="older-area">
          <button wx:if="{{hasMore && !loadingOlder && !olderError}}" bindtap="handleLoadOlder" hover-class="older-button--pressed">加载更早消息</button>
          <text wx:elif="{{loadingOlder}}">正在加载…</text>
          <button wx:elif="{{olderError}}" bindtap="handleLoadOlder" hover-class="older-button--pressed">{{olderError}} ↻</button>
        </view>

        <view wx:if="{{!messages.length}}" class="chat-empty">
          <view class="empty-bubble" aria-hidden="true"><view class="empty-dot"></view><view class="empty-dot"></view><view class="empty-dot"></view></view>
          <view class="empty-title">还没有消息</view>
          <view class="empty-copy">打个招呼，开始商量这次拼单吧～</view>
          <view class="quick-prompts" aria-label="快捷破冰语">
            <button wx:for="{{quickPrompts}}" wx:key="*this" class="quick-prompt" data-text="{{item}}" bindtap="handleQuickPrompt" hover-class="quick-prompt--pressed">{{item}}</button>
          </view>
          <view class="empty-safety">请注意个人安全，不要发送联系方式或外部链接</view>
        </view>

        <block wx:for="{{messages}}" wx:key="id">
          <view wx:if="{{item.showTime}}" class="message-time-pill">{{item.displayTime}}</view>
          <view id="{{item.anchorId}}" class="message-row {{item.isMine ? 'message-row--mine' : ''}} {{item.compact ? 'message-row--compact' : ''}}">
            <view wx:if="{{!item.isMine}}" class="message-avatar-slot" aria-hidden="true"><view wx:if="{{item.showPeerAvatar}}" class="message-avatar message-avatar--{{peerTone}}">{{peerInitial}}</view></view>
            <view class="message-bubble" role="text" aria-label="{{item.accessibilityLabel}}"><text class="message-text" user-select="true">{{item.text}}</text></view>
          </view>
        </block>
        <view class="scroll-spacer"></view>
      </scroll-view>

      <view class="composer">
        <view wx:if="{{!messagingAvailable}}" class="composer-closed" role="status"><text class="closed-lock" aria-hidden="true">⌁</text><text>共同拼单已结束，历史私信仅供查看</text></view>
        <block wx:else>
          <view wx:if="{{sendError}}" class="composer-error" role="alert">{{sendError}}</view>
          <view class="composer-row">
            <textarea
              class="composer-input"
              value="{{text}}"
              maxlength="500"
              auto-height="true"
              adjust-position="true"
              cursor-spacing="24"
              confirm-type="send"
              placeholder="输入消息"
              placeholder-class="composer-placeholder"
              bindinput="handleInput"
              bindfocus="handleComposerFocus"
              bindconfirm="handleSend"
              aria-label="私信内容"
            />
            <button class="send-button" bindtap="handleSend" disabled="{{sending || !canSend}}" hover-class="send-button--pressed">{{sending ? '发送中' : '发送'}}</button>
          </view>
          <view class="composer-hint">仅支持文字沟通，请勿发送联系方式或外部链接</view>
        </block>
      </view>
    </block>
  </view>
</view>

```

## miniprogram/subpackages/message/chat/index.wxss
```css
page {
  height: 100%;
  background: #075aa7;
}

.chat-page {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background: #075aa7;
  box-sizing: border-box;
}

.chat-navigation {
  position: absolute;
  z-index: 5;
  top: 0;
  right: 0;
  left: 0;
  color: #fff8ee;
}

.chat-navigation-row {
  position: absolute;
  right: 0;
  bottom: 8px;
  left: 0;
  height: 44px;
}

.chat-back-button {
  position: absolute;
  top: 0;
  left: 14rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 88rpx;
  height: 88rpx;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
}

.chat-back-button::after,
.source-main::after,
.source-report::after,
.send-button::after,
.quick-prompt::after,
.older-area button::after,
.state-action::after {
  display: none;
}

.chat-back-chevron {
  width: 19rpx;
  height: 19rpx;
  margin-left: 7rpx;
  border-bottom: 5rpx solid #fff8ee;
  border-left: 5rpx solid #fff8ee;
  border-radius: 2rpx;
  transform: rotate(45deg);
}

.chat-nav-button--pressed { opacity: 0.64; }

.chat-navigation-title {
  position: absolute;
  top: 0;
  right: 206rpx;
  left: 102rpx;
  overflow: hidden;
  color: #fff8ee;
  font-size: 31rpx;
  font-weight: 760;
  line-height: 88rpx;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-shell {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
}

.source-strip {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  min-height: 88rpx;
  margin: 4rpx 24rpx 10rpx;
  overflow: hidden;
  background: #fff8ee;
  border: 2rpx solid #eadbc7;
  border-radius: 20rpx 17rpx 21rpx 18rpx;
  box-shadow: 0 6rpx 14rpx rgba(5, 39, 85, 0.14);
}

.source-main {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 88rpx;
  align-items: center;
  gap: 10rpx;
  margin: 0;
  padding: 0 14rpx 0 18rpx;
  border: 0;
  background: transparent;
  color: #102a43;
  line-height: 1.2;
  text-align: left;
}

.source-main[disabled] { opacity: 1; }
.source-main--pressed { background: #faf2e4; }

.source-tag {
  flex: 0 0 auto;
  padding: 7rpx 11rpx;
  border-radius: 18rpx 15rpx 19rpx 16rpx;
  color: #fff8ee;
  font-size: 19rpx;
  font-weight: 700;
  line-height: 24rpx;
}

.source-tag--companion { background: #218f91; }
.source-tag--sport { background: #6b52b5; }
.source-tag--food { background: #d96b24; }

.source-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 23rpx;
  font-weight: 700;
  line-height: 34rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-arrow {
  flex: 0 0 auto;
  color: #657d90;
  font-size: 34rpx;
}

.source-divider {
  flex: 0 0 auto;
  width: 2rpx;
  height: 48rpx;
  background: #dfd1bd;
}

.source-report {
  flex: 0 0 112rpx;
  width: 112rpx;
  min-height: 88rpx;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: #a0522c;
  font-size: 21rpx;
  font-weight: 650;
  line-height: 88rpx;
}

.source-report text {
  display: inline-flex;
  width: 28rpx;
  height: 28rpx;
  align-items: center;
  justify-content: center;
  background: #d96b24;
  border-radius: 50%;
  color: #fff8ee;
  font-size: 18rpx;
  line-height: 28rpx;
}

.source-report--pressed { background: #f8e8d7; }

.message-scroll {
  position: relative;
  z-index: 1;
  flex: 1;
  width: 100%;
  height: 0;
  min-height: 0;
  box-sizing: border-box;
}

.older-area {
  display: flex;
  min-height: 64rpx;
  align-items: center;
  justify-content: center;
  color: rgba(255, 248, 238, 0.82);
  font-size: 21rpx;
}

.older-area button {
  min-height: 56rpx;
  margin: 0;
  padding: 8rpx 22rpx;
  border: 0;
  border-radius: 28rpx;
  background: rgba(255, 248, 238, 0.19);
  color: #fff8ee;
  font-size: 21rpx;
  line-height: 38rpx;
}

.older-button--pressed { opacity: 0.72; }

.message-time-pill {
  display: table;
  width: auto;
  min-height: 40rpx;
  margin: 17rpx auto 10rpx;
  padding: 0 16rpx;
  border-radius: 20rpx;
  background: rgba(255, 248, 238, 0.2);
  color: rgba(255, 248, 238, 0.86);
  font-size: 20rpx;
  line-height: 40rpx;
  text-align: center;
}

.message-row {
  display: flex;
  align-items: flex-end;
  justify-content: flex-start;
  gap: 12rpx;
  padding: 8rpx 24rpx;
}

.message-row--compact { padding-top: 2rpx; }
.message-row--mine { justify-content: flex-end; }

.message-avatar-slot {
  flex: 0 0 64rpx;
  width: 64rpx;
  height: 64rpx;
}

.message-avatar {
  width: 64rpx;
  height: 64rpx;
  border: 2rpx solid rgba(255, 248, 238, 0.86);
  border-radius: 50%;
  color: #fff8ee;
  font-size: 28rpx;
  font-weight: 700;
  line-height: 60rpx;
  text-align: center;
  box-shadow: 0 3rpx 8rpx rgba(5, 39, 85, 0.15);
}

.message-avatar--blue { background: #4b83c4; }
.message-avatar--purple { background: #7664b8; }
.message-avatar--orange { background: #df8541; }
.message-avatar--green { background: #5a9a65; }
.message-avatar--teal { background: #2c8d8c; }

.message-bubble {
  max-width: 72%;
  padding: 17rpx 21rpx;
  overflow: hidden;
  background: #fff8ee;
  border: 2rpx solid #eadbc7;
  border-radius: 22rpx 22rpx 22rpx 7rpx;
  box-shadow: 0 5rpx 12rpx rgba(5, 39, 85, 0.13);
  color: #102a43;
  font-size: 28rpx;
  line-height: 1.45;
  overflow-wrap: anywhere;
  user-select: text;
  -webkit-user-select: text;
  word-break: break-all;
}

.message-row--mine .message-bubble {
  background: #e2f6ec;
  border-color: #bce8d1;
  border-radius: 22rpx 22rpx 7rpx 22rpx;
  color: #0d4a30;
}

.message-text { user-select: text; }

.chat-empty {
  display: flex;
  min-height: 620rpx;
  padding: 90rpx 40rpx 40rpx;
  align-items: center;
  flex-direction: column;
  color: #fff8ee;
  text-align: center;
}

.empty-bubble {
  position: relative;
  display: flex;
  width: 92rpx;
  height: 68rpx;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  border: 5rpx solid rgba(255, 248, 238, 0.82);
  border-radius: 30rpx 27rpx 31rpx 25rpx;
  transform: rotate(-3deg);
}

.empty-bubble::after {
  position: absolute;
  bottom: -16rpx;
  left: 18rpx;
  width: 20rpx;
  height: 20rpx;
  border-bottom: 5rpx solid rgba(255, 248, 238, 0.82);
  border-left: 5rpx solid rgba(255, 248, 238, 0.82);
  content: '';
  transform: skewY(-28deg);
}

.empty-dot {
  width: 9rpx;
  height: 9rpx;
  background: #fff8ee;
  border-radius: 50%;
}

.empty-title {
  margin-top: 30rpx;
  font-size: 31rpx;
  font-weight: 760;
}

.empty-copy {
  margin-top: 10rpx;
  color: rgba(255, 248, 238, 0.82);
  font-size: 24rpx;
  line-height: 1.5;
}

.quick-prompts {
  display: flex;
  width: 100%;
  max-width: 600rpx;
  margin-top: 30rpx;
  flex-direction: column;
  gap: 14rpx;
}

.quick-prompt {
  min-height: 72rpx;
  margin: 0;
  padding: 14rpx 20rpx;
  border: 2rpx solid rgba(234, 219, 199, 0.92);
  border-radius: 22rpx 19rpx 23rpx 20rpx;
  background: #fff8ee;
  color: #1d5f4b;
  font-size: 23rpx;
  line-height: 40rpx;
}

.quick-prompt--pressed { opacity: 0.82; transform: scale(0.985); }

.empty-safety {
  margin-top: 24rpx;
  color: rgba(255, 248, 238, 0.7);
  font-size: 21rpx;
  line-height: 1.5;
}

.scroll-spacer { height: 24rpx; }

.composer {
  position: relative;
  z-index: 3;
  flex: 0 0 auto;
  min-height: 100rpx;
  padding: 14rpx 20rpx calc(12rpx + env(safe-area-inset-bottom));
  background: #fff8ee;
  border-top: 2rpx solid #eadbc7;
  box-shadow: 0 -7rpx 20rpx rgba(5, 39, 85, 0.12);
}

.composer-row {
  display: flex;
  align-items: flex-end;
  gap: 14rpx;
}

.composer-input {
  flex: 1;
  width: auto;
  min-width: 0;
  min-height: 68rpx;
  max-height: 180rpx;
  padding: 14rpx 20rpx;
  border: 2rpx solid #ded5c7;
  border-radius: 22rpx 19rpx 23rpx 20rpx;
  background: #f4efe6;
  color: #102a43;
  font-size: 28rpx;
  line-height: 40rpx;
  box-sizing: border-box;
}

.composer-placeholder { color: #829ab1; }

.send-button {
  flex: 0 0 120rpx;
  width: 120rpx;
  min-height: 68rpx;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 34rpx;
  background: #16a36a;
  color: #fff;
  font-size: 25rpx;
  font-weight: 700;
  line-height: 68rpx;
}

.send-button[disabled] { background: #d1d5d2; color: #8f9a94; }
.send-button--pressed { opacity: 0.82; transform: scale(0.97); }

.composer-hint,
.composer-error {
  min-height: 32rpx;
  margin-top: 7rpx;
  padding: 0 5rpx;
  font-size: 20rpx;
  line-height: 30rpx;
}

.composer-hint { color: #788d83; }
.composer-error { color: #bd4f32; font-weight: 650; }

.composer-closed {
  display: flex;
  min-height: 76rpx;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
  color: #71869a;
  font-size: 24rpx;
  line-height: 34rpx;
  text-align: center;
}

.closed-lock {
  color: #789889;
  font-size: 31rpx;
  font-weight: 800;
}

.chat-state {
  position: relative;
  z-index: 2;
  display: flex;
  flex: 1;
  min-height: 0;
  padding: 70rpx 30rpx;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  color: #fff8ee;
  text-align: center;
  box-sizing: border-box;
}

.chat-state--loading { justify-content: flex-start; }

.state-source-skeleton,
.state-bubble-skeleton {
  height: 74rpx;
  border-radius: 22rpx;
  background: rgba(255, 248, 238, 0.3);
}

.state-source-skeleton { width: 100%; }
.state-bubble-skeleton { width: 64%; margin-top: 38rpx; align-self: flex-start; }
.state-bubble-skeleton--right { width: 56%; align-self: flex-end; }
.state-bubble-skeleton--short { width: 42%; }

.skeleton-shimmer { animation: skeleton-pulse 1.25s ease-in-out infinite alternate; }

@keyframes skeleton-pulse {
  from { opacity: 0.48; }
  to { opacity: 0.86; }
}

.state-chat-icon {
  position: relative;
  width: 88rpx;
  height: 68rpx;
  border: 5rpx solid #fff8ee;
  border-radius: 30rpx 27rpx 31rpx 25rpx;
}

.state-chat-icon::after {
  position: absolute;
  bottom: -17rpx;
  left: 18rpx;
  width: 20rpx;
  height: 20rpx;
  border-bottom: 5rpx solid #fff8ee;
  border-left: 5rpx solid #fff8ee;
  content: '';
}

.state-title { margin-top: 30rpx; font-size: 31rpx; font-weight: 760; }
.state-copy { max-width: 520rpx; margin-top: 12rpx; color: rgba(255, 248, 238, 0.8); font-size: 24rpx; line-height: 1.5; }

.state-action {
  min-height: 88rpx;
  margin-top: 28rpx;
  padding: 0 38rpx;
  border: 0;
  border-radius: 44rpx;
  background: #fff8ee;
  color: #11784f;
  font-size: 25rpx;
  font-weight: 700;
  line-height: 88rpx;
}

.paper-button--pressed { opacity: 0.82; transform: scale(0.98); }

@media (max-width: 340px) {
  .source-strip { margin-right: 16rpx; margin-left: 16rpx; }
  .source-main { padding-left: 14rpx; }
  .source-report { flex-basis: 104rpx; width: 104rpx; font-size: 20rpx; }
  .message-row { padding-right: 18rpx; padding-left: 18rpx; }
  .message-bubble { max-width: 70%; padding-right: 18rpx; padding-left: 18rpx; }
  .send-button { flex-basis: 104rpx; width: 104rpx; }
  .composer { padding-right: 16rpx; padding-left: 16rpx; }
}

```

## miniprogram/utils/direct-message-view.js
```javascript
'use strict';

const { formatDateTime } = require('./date');

const GROUP_WINDOW_MS = 3 * 60 * 1000;
const AVATAR_TONES = Object.freeze(['blue', 'purple', 'orange', 'green', 'teal']);

function timestamp(value) {
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : NaN;
}

function safeAnchorId(id, index) {
  const normalized = String(id || `item-${index}`).replace(/[^A-Za-z0-9_-]/g, '-');
  return `message-${normalized}`;
}

function decorateMessageList(items = [], peerNickname = '拼吧用户') {
  const nickname = String(peerNickname || '拼吧用户').trim() || '拼吧用户';
  return items.map((item, index) => {
    const previous = index > 0 ? items[index - 1] : null;
    const currentTime = timestamp(item.createdAt);
    const previousTime = previous ? timestamp(previous.createdAt) : NaN;
    const sameSender = Boolean(previous) && Boolean(previous.isMine) === Boolean(item.isMine);
    const gap = currentTime - previousTime;
    const compact = sameSender && Number.isFinite(gap) && gap >= 0 && gap < GROUP_WINDOW_MS;
    const displayTime = formatDateTime(item.createdAt);
    const sender = item.isMine ? '我' : nickname;
    return {
      ...item,
      anchorId: safeAnchorId(item.id, index),
      displayTime,
      showTime: !compact,
      showPeerAvatar: !item.isMine && !compact,
      compact,
      accessibilityLabel: `${sender}发送的消息：${String(item.text || '')}，发送时间${displayTime}`
    };
  });
}

function getPeerIdentity(nickname) {
  const normalized = String(nickname || '拼吧用户').trim() || '拼吧用户';
  const initial = Array.from(normalized)[0] || '拼';
  return {
    nickname: normalized,
    initial,
    tone: AVATAR_TONES[(initial.codePointAt(0) || 0) % AVATAR_TONES.length]
  };
}

function mergeMessages(existing = [], incoming = []) {
  const byId = new Map();
  [...existing, ...incoming].forEach((item) => {
    if (item && typeof item.id === 'string' && item.id) byId.set(item.id, item);
  });
  return [...byId.values()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))
    || String(a.id).localeCompare(String(b.id)));
}

module.exports = {
  GROUP_WINDOW_MS,
  decorateMessageList,
  getPeerIdentity,
  mergeMessages
};

```

## miniprogram/utils/tab-bar.js
```javascript
'use strict';

const directMessageService = require('../services/direct-message');
const api = require('../services/api');

let confirmedScope = '';
let confirmedUnread = 0;
let requestSequence = 0;

function actorScope() {
  try {
    const user = typeof getApp === 'function' && getApp().globalData.user;
    return user && user.status === 'ACTIVE' && user.profileComplete ? api.getActorScope() : '';
  } catch (error) { return ''; }
}

function resolveTabBar(page) {
  try {
    if (!page && typeof getCurrentPages === 'function') {
      const pages = getCurrentPages();
      page = pages[pages.length - 1];
    }
    return page && typeof page.getTabBar === 'function' ? page.getTabBar() : null;
  } catch (error) { return null; }
}

function syncScope() {
  const scope = actorScope();
  if (scope !== confirmedScope) {
    confirmedScope = scope;
    confirmedUnread = 0;
    requestSequence += 1;
  }
  return scope;
}

function selectTab(page, selected) {
  const scope = syncScope();
  const tabBar = resolveTabBar(page);
  if (tabBar && typeof tabBar.setData === 'function') tabBar.setData({ selected });
  if (tabBar && typeof tabBar.setUnread === 'function') tabBar.setUnread(confirmedUnread);
  if (scope) refreshUnread(page);
}

async function refreshUnread(page) {
  const scope = syncScope();
  const sequence = ++requestSequence;
  const tabBar = resolveTabBar(page);
  if (!scope) {
    if (tabBar && typeof tabBar.setUnread === 'function') tabBar.setUnread(0);
    return 0;
  }
  try {
    const result = await directMessageService.unread();
    if (sequence !== requestSequence || actorScope() !== scope) return confirmedUnread;
    const total = result && result.totalUnread;
    if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid unread summary');
    confirmedUnread = total;
    if (tabBar && typeof tabBar.setUnread === 'function') tabBar.setUnread(total);
    return total;
  } catch (error) {
    // Keep the last confirmed badge when refresh fails. A network error is not
    // evidence that unread messages disappeared.
    return confirmedUnread;
  }
}

module.exports = { selectTab, refreshUnread };

```

## miniprogram/services/direct-message.js
```javascript
'use strict';

const api = require('./api');

module.exports = {
  unread: () => api.invoke('dm.unread'),
  listConversations: (cursor, limit = 20) => api.invoke('dm.conversation.list', { cursor, limit }),
  createConversation: (activityId, memberId) => api.invoke(
    'dm.conversation.create',
    { activityId, memberId },
    { mutating: true }
  ),
  listMessages: (conversationId, cursor, limit = 20) => api.invoke('dm.message.list', { conversationId, cursor, limit }),
  sendMessage: (conversationId, clientMessageId, text) => api.invoke(
    'dm.message.send',
    { conversationId, clientMessageId, text },
    { mutating: true, idempotencyKey: `dm_send:${clientMessageId}` }
  ),
  markRead: (conversationId, lastMessageId) => api.invoke(
    'dm.conversation.read',
    { conversationId, lastMessageId },
    { mutating: true }
  )
};

```

## miniprogram/pages/messages/index.js
```javascript
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
