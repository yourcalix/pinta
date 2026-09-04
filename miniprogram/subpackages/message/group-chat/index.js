'use strict';

const groupMessageService = require('../../../services/group-message');
const { calculateContentTopInset } = require('../../../utils/navigation-layout');

const PAGE_SIZE = 20;
const POLL_MS = 8000;
const clientId = () => `group_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const merge = (current, incoming) => [...new Map([...(current || []), ...(incoming || [])].map(item => [item.id, item])).values()]
  .sort((a, b) => a.sequence - b.sequence)
  .map(item => ({ ...item, anchorId: `group-message-${item.sequence}`,
    senderInitial: String(item.sender && item.sender.nickname || '拼').slice(0, 1) }));

Page({
  data: {
    contentTopInset: 88, id: '', title: '成员群聊', generation: 0, messages: [], nextBefore: null,
    loading: true, loadingOlder: false, error: '', olderError: '', writable: false,
    text: '', sending: false, sendError: '', scrollIntoView: ''
  },
  onLoad(options = {}) {
    this._loadSeq = 0;
    this.setData({ contentTopInset: calculateContentTopInset(typeof wx === 'undefined' ? null : wx), id: String(options.id || '').trim() });
  },
  onShow() {
    this._visible = true;
    this.setData({ sending: Boolean(this._sendToken) });
    return this.load(false);
  },
  onHide() {
    this._visible = false;
    this._loadSeq += 1;
    this.stopPolling();
    this._fetchToken = null;
    this._readToken = null;
    this.setData({ messages: [], generation: 0, nextBefore: null, text: '', writable: false, scrollIntoView: '' });
    try { if (wx.hideKeyboard) wx.hideKeyboard(); } catch (error) { /* best effort */ }
  },
  onUnload() { this.onHide(); this._disposed = true; this._failedDraft = null; },
  stopPolling() { if (this._pollTimer) clearTimeout(this._pollTimer); this._pollTimer = null; },
  schedulePolling() {
    this.stopPolling();
    if (!this._visible || this.data.error) return;
    this._pollTimer = setTimeout(() => { this._pollTimer = null; this.load(false, true); }, POLL_MS);
  },
  async load(older, refresh = false) {
    if (!this._visible || this._fetchToken || !this.data.id || older && !this.data.nextBefore) return;
    const token = {}; const seq = this._loadSeq; this._fetchToken = token; this.stopPolling();
    if (!refresh) this.setData(older ? { loadingOlder: true, olderError: '' } : { loading: true, error: '' });
    const current = () => this._visible && seq === this._loadSeq && this._fetchToken === token;
    try {
      const [thread, page] = await Promise.all([
        groupMessageService.thread(this.data.id),
        groupMessageService.list(this.data.id, older ? this.data.nextBefore : null, PAGE_SIZE)
      ]);
      if (!current()) return;
      if (this.data.generation && this.data.generation !== page.generation) throw Object.assign(new Error('成员状态已变化'), { code: 'CONFLICT' });
      const messages = merge(older ? page.items.concat(this.data.messages) : refresh ? this.data.messages.concat(page.items) : page.items, []);
      await new Promise(resolve => this.setData({
        title: thread.activity && thread.activity.title || '成员群聊', generation: page.generation,
        writable: page.writable === true, messages,
        ...(older || !refresh ? { nextBefore: page.nextBefore, } : {}),
        loading: false, loadingOlder: false, olderError: '', error: ''
      }, resolve));
      if (!current()) return;
      if (!older && messages.length) {
        const latest = messages[messages.length - 1];
        this.setData({ scrollIntoView: latest.anchorId });
        const latestIncoming = [...messages].reverse().find(item => !item.isMine);
        if (latestIncoming) await this.markRead(latestIncoming);
      }
    } catch (error) {
      if (!current()) return;
      if (older) this.setData({ loadingOlder: false, olderError: '更早消息加载失败，点击重试' });
      else if (refresh && !['FORBIDDEN', 'TAKEDOWN', 'ACCOUNT_DISABLED', 'CONFLICT'].includes(error.code)) return;
      else this.setData({ loading: false, messages: [], generation: 0, writable: false,
        error: error.code === 'PROFILE_INCOMPLETE' ? '请先完善成年资料' : '你当前无法访问这个成员群聊' });
    } finally {
      if (this._fetchToken === token) this._fetchToken = null;
      this.schedulePolling();
    }
  },
  async markRead(message) {
    if (!this._visible || !message || this._readToken || !this.data.generation) return;
    const token = {}; const seq = this._loadSeq; this._readToken = token;
    try { await groupMessageService.markRead(this.data.id, this.data.generation, message.id, message.sequence); }
    catch (error) { if (this._visible && seq === this._loadSeq && ['FORBIDDEN', 'TAKEDOWN', 'CONFLICT'].includes(error.code)) this.load(false); }
    finally { if (this._readToken === token) this._readToken = null; }
  },
  handleInput(event) { this.setData({ text: event.detail.value, sendError: '' }); },
  async handleSend() {
    const text = String(this.data.text || '').trim();
    if (!this._visible || !this.data.writable || !text || this._sendToken) return;
    const draft = this._failedDraft && this._failedDraft.text === text ? this._failedDraft : { text, clientMessageId: clientId() };
    this._failedDraft = draft; const token = {}; const seq = this._loadSeq; this._sendToken = token;
    this.setData({ sending: true, sendError: '' });
    try {
      const result = await groupMessageService.send(this.data.id, this.data.generation, draft.clientMessageId, text);
      if (!this._visible || seq !== this._loadSeq) return;
      this._failedDraft = null;
      const messages = merge(this.data.messages, [result.message]);
      this.setData({ messages, text: '', sending: false, scrollIntoView: messages[messages.length - 1].anchorId });
    } catch (error) {
      if (!this._visible || seq !== this._loadSeq) return;
      if (['FORBIDDEN', 'TAKEDOWN', 'CONFLICT'].includes(error.code)) return this.load(false);
      this.setData({ sendError: error.code === 'CONTENT_REJECTED' ? '内容未通过安全检查' : '发送失败，内容已保留，请重试' });
    } finally { if (this._sendToken === token) this._sendToken = null; if (this._visible) this.setData({ sending: false }); }
  },
  handleLoadOlder() { this.load(true); },
  handleRetry() { this.load(false); },
  handleBack() {
    let pages = []; try { pages = getCurrentPages(); } catch (error) { /* fallback */ }
    if (pages.length > 1) wx.navigateBack({ delta: 1 });
    else wx.switchTab({ url: '/pages/discover/index' });
  }
});
