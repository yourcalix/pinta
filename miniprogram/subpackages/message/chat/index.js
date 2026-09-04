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
    emptyCopy: '打个招呼，开始商量这次拼单吧～',
    closedText: '共同拼单已结束，历史私信仅供查看',
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
      const isConsult = conversation.kind === 'OWNER_CONSULT';
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
        sourceTypeLabel: isConsult ? '咨询发起人' : (SOURCE_LABELS[sourceType] || '共同拼单'),
        sourceTone: SOURCE_LABELS[sourceType] ? sourceType : 'companion',
        emptyCopy: isConsult ? '向发起人问问活动安排吧～' : '打个招呼，开始商量这次拼单吧～',
        closedText: isConsult ? '当前活动已结束，这段咨询仅供查看' : '共同拼单已结束，历史私信仅供查看',
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
