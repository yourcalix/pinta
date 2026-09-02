'use strict';

const directMessageService = require('../../../services/direct-message');
const { formatDateTime } = require('../../../utils/date');

const PAGE_SIZE = 20;

function decorateMessage(item) {
  return { ...item, displayTime: formatDateTime(item.createdAt), anchorId: `message-${item.id.replace(/[^A-Za-z0-9_-]/g, '-')}` };
}

function makeClientMessageId() {
  return `client_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

Page({
  data: {
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
    canSend: false,
    messagingAvailable: false,
    peerInitial: '拼',
    scrollIntoView: ''
  },

  onLoad(options = {}) {
    this.setData({ id: String(options.id || '').trim() });
    return this.loadMessages(false);
  },

  onUnload() { this._loadSeq = (this._loadSeq || 0) + 1; },

  async loadMessages(older) {
    if (older && (!this.data.nextCursor || this.data.loadingOlder)) return;
    const seq = older ? (this._loadSeq || 0) : (this._loadSeq = (this._loadSeq || 0) + 1);
    if (!this.data.id) return this.setData({ loading: false, error: '会话不存在或已失效' });
    this.setData(older ? { loadingOlder: true, olderError: '' } : { loading: true, error: '', messages: [] });
    try {
      const result = await directMessageService.listMessages(this.data.id, older ? this.data.nextCursor : undefined, PAGE_SIZE);
      if (seq !== this._loadSeq) return;
      const incoming = (result.items || []).map(decorateMessage).reverse();
      const messages = older ? [...incoming, ...this.data.messages] : incoming;
      const last = messages[messages.length - 1];
      this.setData({
        conversation: result.conversation,
        messagingAvailable: result.conversation.messagingAvailable === true,
        canSend: result.conversation.messagingAvailable === true && Boolean(String(this.data.text || '').trim()),
        peerInitial: Array.from(String(result.conversation && result.conversation.peer && result.conversation.peer.nickname || '拼'))[0] || '拼',
        messages,
        nextCursor: result.nextCursor || '',
        hasMore: Boolean(result.nextCursor),
        loading: false,
        loadingOlder: false,
        olderError: '',
        error: '',
        scrollIntoView: older || !last ? '' : last.anchorId
      });
      if (!older) {
        const lastMessageId = result.conversation && result.conversation.lastMessage && result.conversation.lastMessage.id;
        if (lastMessageId) {
          try { await directMessageService.markRead(this.data.id, lastMessageId); } catch (error) { /* Read failure must not hide messages. */ }
        }
      }
    } catch (error) {
      if (seq !== this._loadSeq) return;
      if (older) return this.setData({ loadingOlder: false, olderError: '更早消息加载失败，点击重试' });
      this.setData({ loading: false, error: error.handled ? '账号暂时无法使用' : error.message || '私信加载失败，请重试' });
    }
  },

  handleInput(event) {
    const text = event.detail.value;
    this.setData({ text, canSend: this.data.messagingAvailable && Boolean(String(text || '').trim()) });
  },

  async handleSend() {
    const text = String(this.data.text || '').trim();
    if (!text || this.data.sending || !this.data.messagingAvailable) return;
    this.setData({ sending: true });
    try {
      const result = await directMessageService.sendMessage(this.data.id, makeClientMessageId(), text);
      const message = decorateMessage(result.message);
      this.setData({ messages: [...this.data.messages, message], text: '', canSend: false, scrollIntoView: message.anchorId });
    } catch (error) {
      if (error && error.code === 'CONFLICT') {
        this.setData({ messagingAvailable: false, canSend: false });
      }
      if (!error.handled) wx.showToast({ title: error.message || '发送失败，请重试', icon: 'none' });
    } finally {
      this.setData({ sending: false });
    }
  },

  handleLoadOlder() { this.loadMessages(true); },
  handleRetry() { this.loadMessages(false); },

  handleReport() {
    if (!this.data.id) return;
    wx.navigateTo({
      url: `/subpackages/safety/report/index?type=directConversation&id=${encodeURIComponent(this.data.id)}&from=chat`
    });
  }
});
