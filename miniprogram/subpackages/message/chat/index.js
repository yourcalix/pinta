'use strict';

const directMessageService = require('../../../services/direct-message');
const { calculateContentTopInset } = require('../../../utils/navigation-layout');
const { decorateMessageList, getPeerIdentity } = require('../../../utils/direct-message-view');

const PAGE_SIZE = 20;
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
    this.setData({
      contentTopInset: calculateContentTopInset(typeof wx === 'undefined' ? null : wx),
      id: String(options.id || '').trim()
    });
    return this.loadMessages(false);
  },

  onUnload() {
    this._loadSeq = (this._loadSeq || 0) + 1;
    if (this._focusScrollTimer) clearTimeout(this._focusScrollTimer);
    hideKeyboardSafely();
  },

  async loadMessages(older) {
    if (older && (!this.data.nextCursor || this.data.loadingOlder)) return;
    const seq = older ? (this._loadSeq || 0) : (this._loadSeq = (this._loadSeq || 0) + 1);
    if (!this.data.id) return this.setData({ loading: false, error: '会话不存在或已失效' });
    this.setData(older
      ? { loadingOlder: true, olderError: '' }
      : { loading: true, error: '', sendError: '', messages: [] });
    try {
      const result = await directMessageService.listMessages(this.data.id, older ? this.data.nextCursor : undefined, PAGE_SIZE);
      if (seq !== this._loadSeq) return;
      const conversation = result.conversation || {};
      const peer = getPeerIdentity(conversation.peer && conversation.peer.nickname);
      const incoming = (result.items || []).slice().reverse();
      const rawMessages = older ? [...incoming, ...this.data.messages] : incoming;
      const messages = decorateMessageList(rawMessages, peer.nickname);
      const last = messages[messages.length - 1];
      const messagingAvailable = conversation.messagingAvailable === true;
      const sourceType = conversation.source && conversation.source.activityType;
      if (this.data.messagingAvailable && !messagingAvailable) hideKeyboardSafely();
      this.setData({
        conversation,
        messagingAvailable,
        canSend: messagingAvailable && Boolean(String(this.data.text || '').trim()),
        peerName: peer.nickname,
        peerInitial: peer.initial,
        peerTone: peer.tone,
        sourceTypeLabel: SOURCE_LABELS[sourceType] || '共同拼单',
        sourceTone: SOURCE_LABELS[sourceType] ? sourceType : 'companion',
        messages,
        nextCursor: result.nextCursor || '',
        hasMore: Boolean(result.nextCursor),
        loading: false,
        loadingOlder: false,
        olderError: '',
        error: '',
        scrollWithAnimation: false,
        scrollIntoView: older || !last ? '' : last.anchorId
      });
      if (!older) {
        const lastMessageId = conversation.lastMessage && conversation.lastMessage.id;
        if (lastMessageId) {
          try { await directMessageService.markRead(this.data.id, lastMessageId); } catch (error) { /* Read failure must not hide messages. */ }
        }
      }
    } catch (error) {
      if (seq !== this._loadSeq) return;
      if (older) return this.setData({ loadingOlder: false, olderError: '更早消息加载失败，点击重试' });
      this.setData({
        loading: false,
        error: error && error.handled ? '账号暂时无法使用' : '私信暂时没有加载出来，请稍后重试'
      });
    }
  },

  handleInput(event) {
    const text = event.detail.value;
    this.setData({
      text,
      sendError: '',
      canSend: this.data.messagingAvailable && Boolean(String(text || '').trim())
    });
  },

  handleQuickPrompt(event) {
    const text = String(event.currentTarget.dataset.text || '').slice(0, 500);
    this.setData({ text, sendError: '', canSend: this.data.messagingAvailable && Boolean(text.trim()) });
  },

  handleComposerFocus() {
    if (this._focusScrollTimer) clearTimeout(this._focusScrollTimer);
    this._focusScrollTimer = setTimeout(() => {
      this._focusScrollTimer = null;
      this.scrollToLatest(true);
    }, 50);
  },

  scrollToLatest(animated) {
    const last = this.data.messages[this.data.messages.length - 1];
    if (!last) return;
    this.setData({ scrollIntoView: '', scrollWithAnimation: Boolean(animated) }, () => {
      this.setData({ scrollIntoView: last.anchorId });
    });
  },

  async handleSend() {
    const text = String(this.data.text || '').trim();
    if (!text || this.data.sending || !this.data.messagingAvailable) return;
    this.setData({ sending: true, sendError: '' });
    try {
      const result = await directMessageService.sendMessage(this.data.id, makeClientMessageId(), text);
      const messages = decorateMessageList([...this.data.messages, result.message], this.data.peerName);
      this.setData({ messages, text: '', canSend: false, sending: false }, () => this.scrollToLatest(true));
    } catch (error) {
      if (error && error.code === 'CONFLICT') {
        hideKeyboardSafely();
        this.setData({ messagingAvailable: false, canSend: false, sendError: '' });
      } else {
        this.setData({ sendError: error && error.handled ? '账号暂时无法使用' : '发送失败，内容已保留，请重试' });
      }
    } finally {
      if (this.data.sending) this.setData({ sending: false });
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
