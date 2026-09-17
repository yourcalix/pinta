'use strict';

const communityService = require('../../../services/community');
const userService = require('../../../services/user');
const safetyService = require('../../../services/safety');
const { COMMUNITY_REPORT_REASONS } = require('../../../utils/community-report-reasons');
const { calculateContentTopInset } = require('../../../utils/navigation-layout');
const { normalizeAvatarSlots, fallbackAvatarSlot } = require('../../../utils/passenger-avatar');
const { openCommunityAuthor } = require('../../../utils/open-community-author');

const PAGE_SIZE = 20;
const MAX_REPLY_LOCATE_PAGES = 10;
const MAX_REPLY_LOCATE_ITEMS = PAGE_SIZE * MAX_REPLY_LOCATE_PAGES;
const REPLY_LOCATE_RETRY_MS = 50;
const REPLY_HIGHLIGHT_MS = 1600;
const AVATAR_TONES = ['blue', 'purple', 'orange', 'green', 'teal'];
const EMPTY_MODAL = Object.freeze({ visible: false, type: 'delete', title: '', description: '', confirmText: '', cancelText: '', danger: false, loading: false, closeOnMask: false });
function modalState(patch = {}) { return { ...EMPTY_MODAL, ...patch }; }
function normalizeReplyRouteId(value) {
  const id = String(value || '').trim();
  return id && id.length <= 80 ? id : '';
}
function splitContentSegments(content) {
  const source = String(content || '');
  const segments = [];
  const matcher = /#[\u4e00-\u9fa5A-Za-z0-9_]+/g;
  let cursor = 0;
  let match = matcher.exec(source);
  while (match) {
    if (match.index > cursor) segments.push({ type: 'text', text: source.slice(cursor, match.index) });
    segments.push({ type: 'tag', text: match[0] });
    cursor = match.index + match[0].length;
    match = matcher.exec(source);
  }
  if (cursor < source.length) segments.push({ type: 'text', text: source.slice(cursor) });
  return segments.length ? segments : [{ type: 'text', text: source }];
}

function formatCommunityTime(value, now = Date.now()) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}小时前`;
  if (minutes < 7 * 1440) return `${Math.floor(minutes / 1440)}天前`;
  const beijingDate = new Date(timestamp + 8 * 60 * 60 * 1000);
  return `${beijingDate.getUTCMonth() + 1}月${beijingDate.getUTCDate()}日`;
}

function decorate(item) {
  const nickname = String(item && item.author && item.author.nickname || '拼吧用户').trim() || '拼吧用户';
  const avatarInitial = Array.from(nickname)[0] || '拼';
  const replyTo = item && item.replyTo && ['ACTIVE', 'UNAVAILABLE'].includes(item.replyTo.status) ? item.replyTo : null;
  const replyToNickname = replyTo && replyTo.status === 'ACTIVE' ? String(replyTo.nickname || '').trim() : '';
  return {
    ...item,
    avatarSlot: normalizeAvatarSlots([item && item.author && item.author.avatar], 1)[0],
    authorNickname: nickname,
    avatarInitial,
    avatarTone: AVATAR_TONES[(avatarInitial.codePointAt(0) || 0) % AVATAR_TONES.length],
    contentSegments: splitContentSegments(item && item.content),
    displayTime: formatCommunityTime(item && item.createdAt),
    likeCount: Math.max(0, Number(item && item.likeCount) || 0),
    viewerHasLiked: Boolean(item && item.viewerHasLiked),
    replyTo,
    replyToNickname,
    replyToDisplayName: replyTo ? (replyTo.status === 'ACTIVE' ? `@${replyToNickname}` : '已删除评论') : '',
    replyToUnavailable: Boolean(replyTo && replyTo.status !== 'ACTIVE'),
    replyContextLabel: replyTo ? `回复${replyToNickname || '已删除评论'}，` : '',
    likePending: false
  };
}

function mergeReplies(current, incoming) {
  const map = new Map([...(current || []), ...(incoming || [])].map((item) => [item.id, item]));
  return [...map.values()].sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)) || String(left.id).localeCompare(String(right.id)));
}

Page({
  data: {
    contentTopInset: 88,
    postId: '', post: null, replies: [], replyContent: '', replyTarget: null,
    replyPlaceholder: '写下你的回复…', replyCursorSpacing: 120, submitting: false,
    loading: true, error: '', nextCursor: '', hasMore: false,
    loadingMore: false, loadMoreError: '', replyInputFocus: false, locatedReplyId: '',
    modal: modalState()
  },

  onLoad(options) {
    options = options || {};
    this._disposed = false;
    this._replyLocateSeq = 0;
    this._replyLocatePending = false;
    this._replyLocateSettled = false;
    this._replyLocateStopped = false;
    this._resumeDetailLoad = false;
    this._targetReplyId = normalizeReplyRouteId(options.replyId);
    const postId = String(options.id || '').trim();
    const activityId = String(options.activityId || '').trim();
    const activityUpdatedAt = String(options.activityUpdatedAt || '').trim();
    this._sourceActivity = activityId && Number.isFinite(Date.parse(activityUpdatedAt))
      ? { id: activityId, updatedAt: activityUpdatedAt, postId, pending: false, done: false }
      : null;
    this._replyFocus = options.reply === '1' && Boolean(postId);
    const contentTopInset = calculateContentTopInset(typeof wx === 'undefined' ? null : wx);
    this.setData(postId ? { postId, contentTopInset } : { postId: '', contentTopInset, loading: false, error: '讨论参数无效' });
    if (!postId) return;
    return this.loadDetail(false);
  },
  onShow() {
    this._disposed = false;
    this._authorNavPending = false;
    if (this._resumeDetailLoad) {
      this._resumeDetailLoad = false;
      return void this.loadDetail(false);
    }
    if (!this.data.post) return;
    if (!this._targetReplyId || this._replyLocateSettled) return void this.consumeSourceActivity();
    if (!this._replyLocateStopped && !this._replyLocatePending) this.startReplyLocating();
  },
  onHide() {
    this.cancelPendingDelete(true);
    this._resumeDetailLoad = Boolean(!this.data.post && this.data.postId && this.data.loading);
    this.cancelReplyLocating(true);
    if (this.data.loadingMore) this.setData({ loadingMore: false });
    this._disposed = true;
    this._loadSeq = (this._loadSeq || 0) + 1;
  },
  onUnload() {
    this.cancelPendingDelete(false);
    this._resumeDetailLoad = false;
    this.cancelReplyLocating(false);
    this._disposed = true;
    this._replyFocus = false;
    this._loadSeq = (this._loadSeq || 0) + 1;
    if (this._actionLocks) this._actionLocks.clear();
  },

  async loadDetail(append = false) {
    if (this._disposed || !this.data.postId || (append && (!this.data.nextCursor || this.data.loadingMore))) return false;
    const seq = append ? (this._loadSeq || 0) : (this._loadSeq = (this._loadSeq || 0) + 1);
    this.setData(append ? { loadingMore: true, loadMoreError: '' } : { loading: true, error: '', loadMoreError: '', replies: [], nextCursor: '', hasMore: false });
    try {
      const result = await communityService.getPost(this.data.postId, { limit: PAGE_SIZE, cursor: append ? this.data.nextCursor : undefined });
      if (this._disposed || seq !== this._loadSeq) return false;
      const incoming = (result.replies || []).map(decorate);
      const nextData = {
        replies: append ? mergeReplies(this.data.replies, incoming) : incoming,
        nextCursor: result.nextCursor || '', hasMore: Boolean(result.nextCursor),
        loading: false, loadingMore: false, loadMoreError: '', error: ''
      };
      const focus = !append && this._replyFocus;
      if (!append) {
        nextData.post = decorate(result.post);
        nextData.replyInputFocus = false;
        this._replyFocus = false;
      }
      this.setData(nextData);
      if (!append) {
        if (this._targetReplyId) this.startReplyLocating();
        else this.consumeSourceActivity();
      }
      if (focus && await this.ensureInteractionAccess() && !this._disposed && seq === this._loadSeq) {
        this._replyAuthorized = true;
        this.setData({ replyInputFocus: true });
      }
      return true;
    } catch (error) {
      if (this._disposed || seq !== this._loadSeq) return false;
      if (append) {
        this.setData({ loadingMore: false, loadMoreError: '更多回复加载失败，请重试' });
        return false;
      }
      this._replyFocus = false;
      this.setData({ loading: false, loadingMore: false, post: null, replies: [], replyInputFocus: false, error: error.code === 'NOT_FOUND' ? '该讨论已被作者删除或不存在' : '讨论暂时无法查看，请稍后重试' });
      return false;
    }
  },

  cancelReplyLocating(clearHighlight = false) {
    this._replyLocateSeq = (this._replyLocateSeq || 0) + 1;
    this._replyLocatePending = false;
    if (this._replyLocateProbeTimer) clearTimeout(this._replyLocateProbeTimer);
    if (this._replyHighlightTimer) clearTimeout(this._replyHighlightTimer);
    this._replyLocateProbeTimer = null;
    this._replyHighlightTimer = null;
    if (clearHighlight && this.data.locatedReplyId) this.setData({ locatedReplyId: '' });
  },

  async startReplyLocating() {
    if (!this._targetReplyId || this._disposed || this._replyLocatePending || this._replyLocateSettled || this._replyLocateStopped) return false;
    const seq = this._replyLocateSeq = (this._replyLocateSeq || 0) + 1;
    this._replyLocatePending = true;
    let pageCount = Math.max(1, Math.ceil((this.data.replies || []).length / PAGE_SIZE));
    try {
      while (!this._disposed && seq === this._replyLocateSeq) {
        const replies = this.data.replies || [];
        const targetIndex = replies.findIndex((item) => item.id === this._targetReplyId);
        if (targetIndex >= 0) {
          const located = await this.scrollToReply(targetIndex, this._targetReplyId, seq);
          if (!located || this._disposed || seq !== this._replyLocateSeq) {
            if (!this._disposed && seq === this._replyLocateSeq) wx.showToast({ title: '暂时无法定位该回复', icon: 'none' });
            return false;
          }
          this._replyLocateSettled = true;
          await this.consumeSourceActivity();
          return true;
        }
        if (!this.data.hasMore) {
          this._replyLocateSettled = true;
          wx.showToast({ title: '该回复已删除或不可见', icon: 'none' });
          await this.consumeSourceActivity();
          return false;
        }
        if (pageCount >= MAX_REPLY_LOCATE_PAGES || replies.length >= MAX_REPLY_LOCATE_ITEMS) {
          this._replyLocateStopped = true;
          wx.showToast({ title: '回复较多，请继续加载查看', icon: 'none' });
          return false;
        }
        const loaded = await this.loadDetail(true);
        if (this._disposed || seq !== this._replyLocateSeq) return false;
        if (!loaded) {
          wx.showToast({ title: '暂时无法定位该回复', icon: 'none' });
          return false;
        }
        pageCount = Math.max(pageCount + 1, Math.ceil((this.data.replies || []).length / PAGE_SIZE));
      }
      return false;
    } finally {
      if (seq === this._replyLocateSeq) this._replyLocatePending = false;
    }
  },

  waitForReplyAnchor(index, seq, attempt = 0) {
    return new Promise((resolve) => {
      const inspect = () => {
        if (this._disposed || seq !== this._replyLocateSeq) return resolve(false);
        if (!wx.createSelectorQuery) return resolve(true);
        try {
          const query = wx.createSelectorQuery();
          const scoped = query && typeof query.in === 'function' ? query.in(this) : query;
          if (!scoped || typeof scoped.select !== 'function') return resolve(true);
          scoped.select(`#community-reply-${index}`).boundingClientRect((rect) => {
            if (rect) return resolve(true);
            if (attempt >= 2 || this._disposed || seq !== this._replyLocateSeq) return resolve(false);
            this._replyLocateProbeTimer = setTimeout(() => {
              this._replyLocateProbeTimer = null;
              this.waitForReplyAnchor(index, seq, attempt + 1).then(resolve);
            }, REPLY_LOCATE_RETRY_MS);
          }).exec();
        } catch (error) {
          resolve(false);
        }
      };
      if (wx.nextTick) wx.nextTick(inspect);
      else this._replyLocateProbeTimer = setTimeout(inspect, 0);
    });
  },

  async scrollToReply(index, targetId, seq) {
    if (!await this.waitForReplyAnchor(index, seq) || this._disposed || seq !== this._replyLocateSeq || !wx.pageScrollTo) return false;
    this.setData({ locatedReplyId: targetId });
    const scrolled = await new Promise((resolve) => wx.pageScrollTo({
      selector: `#community-reply-${index}`,
      offsetTop: -(Math.max(0, Number(this.data.contentTopInset) || 0) + 12),
      duration: 260,
      success: () => resolve(true),
      fail: () => resolve(false)
    }));
    if (!scrolled || this._disposed || seq !== this._replyLocateSeq) {
      if (!this._disposed && this.data.locatedReplyId === targetId) this.setData({ locatedReplyId: '' });
      return false;
    }
    if (this._replyHighlightTimer) clearTimeout(this._replyHighlightTimer);
    this._replyHighlightTimer = setTimeout(() => {
      this._replyHighlightTimer = null;
      if (!this._disposed && this.data.locatedReplyId === targetId) this.setData({ locatedReplyId: '' });
    }, REPLY_HIGHLIGHT_MS);
    return true;
  },

  async settleTargetAfterManualAppend() {
    if (!this._targetReplyId || this._replyLocateSettled || this._disposed) return;
    const targetIndex = this.data.replies.findIndex((item) => item.id === this._targetReplyId);
    if (targetIndex >= 0) {
      const seq = this._replyLocateSeq = (this._replyLocateSeq || 0) + 1;
      if (await this.scrollToReply(targetIndex, this._targetReplyId, seq)) {
        this._replyLocateSettled = true;
        await this.consumeSourceActivity();
      }
      return;
    }
    if (!this.data.hasMore) {
      this._replyLocateSettled = true;
      wx.showToast({ title: '该回复已删除或不可见', icon: 'none' });
      await this.consumeSourceActivity();
    }
  },

  async consumeSourceActivity() {
    const source = this._sourceActivity;
    if (!source || source.done || source.pending || this._disposed || !this.data.post || this.data.post.id !== source.postId) return;
    source.pending = true;
    try {
      const result = await communityService.readActivity(source.id, source.updatedAt, source.postId);
      if (!this._disposed && result && (result.read === true || result.stale === true)) source.done = true;
    } catch (error) {
      // Keep the source activity unread; reopening or showing the detail can retry safely.
    } finally {
      source.pending = false;
    }
  },

  async ensureInteractionAccess() {
    if (this._accessPromise) return this._accessPromise;
    this._accessPromise = userService.login().then((user) => {
      if (this._disposed) return false;
      if (user.profileComplete) return true;
      if (wx.hideKeyboard) wx.hideKeyboard();
      wx.navigateTo({ url: `/subpackages/profile/edit/index?next=${encodeURIComponent(`/subpackages/community/detail/index?id=${this.data.postId}`)}` });
      return false;
    }).catch((error) => {
      if (!this._disposed && !error.handled) wx.showToast({ title: error.message || '暂时无法登录', icon: 'none' });
      return false;
    }).finally(() => { this._accessPromise = null; });
    return this._accessPromise;
  },

  handleReplyInput(event) { this.setData({ replyContent: event.detail.value.slice(0, 300) }); },
  async handleReplyFocus() {
    if (this._replyAuthorized) return void (this._replyAuthorized = false);
    if (!await this.ensureInteractionAccess()) this.setData({ replyInputFocus: false });
  },
  handleReplyBlur() { if (this.data.replyInputFocus) this.setData({ replyInputFocus: false }); },

  async handleSelectReplyTarget(event) {
    const replyId = String(event.currentTarget.dataset.id || '');
    const target = this.data.replies.find((item) => item.id === replyId);
    if (!target || this._disposed || !await this.ensureInteractionAccess() || this._disposed) return;
    this._replyAuthorized = true;
    if (target.viewerIsAuthor) {
      return void this.setData({ replyTarget: null, replyPlaceholder: '写下你的回复…', replyCursorSpacing: 120, replyInputFocus: true });
    }
    this.setData({
      replyTarget: { id: target.id, nickname: target.authorNickname },
      replyPlaceholder: `回复 @${target.authorNickname}…`,
      replyCursorSpacing: 160,
      replyInputFocus: true
    });
  },
  handleCancelReplyTarget() {
    this._replyAuthorized = true;
    this.setData({ replyTarget: null, replyPlaceholder: '写下你的回复…', replyCursorSpacing: 120, replyInputFocus: true });
  },

  handlePostAvatarError() {
    if (this.data.post) this.setData({ post: this.fallbackAuthorAvatar(this.data.post) });
  },
  handleReplyAvatarError(event) {
    const id = String(event.currentTarget.dataset.id || '');
    if (!id) return;
    this.setData({ replies: this.data.replies.map((item) => item.id === id ? this.fallbackAuthorAvatar(item) : item) });
  },
  fallbackAuthorAvatar(item) {
    if (!item || item.avatarSlot.empty) return item;
    const avatarSlot = fallbackAvatarSlot(item.avatarSlot);
    return { ...item, avatarSlot: avatarSlot === item.avatarSlot ? { ...avatarSlot, src: '', empty: true } : avatarSlot };
  },

  async handleSendReply() {
    const content = this.data.replyContent.trim();
    if (!content || this.data.submitting || !await this.ensureInteractionAccess()) return;
    const replyToId = this.data.replyTarget && this.data.replyTarget.id || '';
    this.setData({ submitting: true });
    try {
      const result = await communityService.createReply(this.data.postId, content, replyToId);
      if (this._disposed) return;
      this.setData({
        replyContent: '', replyTarget: null, replyPlaceholder: '写下你的回复…', replyCursorSpacing: 120, replyInputFocus: false,
        replies: mergeReplies(this.data.replies, [decorate(result.reply)]),
        'post.replyCount': Math.max(0, Number(result.replyCount) || 0)
      });
    } catch (error) {
      if (!this._disposed && !error.handled) wx.showToast({ title: error.message || '回复失败，请重试', icon: 'none' });
    } finally {
      if (!this._disposed) this.setData({ submitting: false });
    }
  },

  updateLikeTarget(targetType, targetId, patch) {
    if (this._disposed) return false;
    let prefix = '';
    if (targetType === 'post') {
      if (!this.data.post || this.data.post.id !== targetId) return false;
      prefix = 'post';
    } else {
      const index = this.data.replies.findIndex((item) => item.id === targetId);
      if (index < 0) return false;
      prefix = `replies[${index}]`;
    }
    const payload = {};
    ['viewerHasLiked', 'likeCount', 'likePending'].forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(patch, field)) payload[`${prefix}.${field}`] = patch[field];
    });
    if (!Object.keys(payload).length) return false;
    this.setData(payload);
    return true;
  },

  async handleLike(event) {
    const { targetType, targetId } = event.currentTarget.dataset;
    const key = `${targetType}:${targetId}`;
    if (this._disposed) return;
    if (!this._likeLocks) this._likeLocks = new Set();
    if (this._likeLocks.has(key)) return;
    this._likeLocks.add(key);
    let before = null;
    try {
      if (!await this.ensureInteractionAccess() || this._disposed) return;
      const target = targetType === 'post' ? this.data.post : this.data.replies.find((item) => item.id === targetId);
      if (!target) return;
      before = { viewerHasLiked: Boolean(target.viewerHasLiked), likeCount: Math.max(0, Number(target.likeCount) || 0) };
      const liked = !before.viewerHasLiked;
      this.updateLikeTarget(targetType, targetId, { viewerHasLiked: liked, likeCount: Math.max(0, before.likeCount + (liked ? 1 : -1)), likePending: true });
      const result = await communityService.setLike(targetType, targetId, liked);
      if (this._disposed) return;
      this.updateLikeTarget(targetType, targetId, { viewerHasLiked: result.liked, likeCount: result.likeCount, likePending: false });
    } catch (error) {
      if (this._disposed) return;
      if (before) this.updateLikeTarget(targetType, targetId, { ...before, likePending: false });
      if (!error.handled) wx.showToast({ title: '点赞失败，请重试', icon: 'none' });
    } finally {
      this._likeLocks.delete(key);
    }
  },

  handlePostMore() { return this.showContentActions('communityPost', this.data.post.id, this.data.post.viewerIsAuthor); },
  handleAuthorProfile(event) {
    const sourceType = String(event.currentTarget.dataset.sourceType || 'post');
    const sourceId = String(event.currentTarget.dataset.id || '').trim();
    if (sourceId) return openCommunityAuthor(this, sourceType, sourceId);
  },
  handleReplyMore(event) {
    const item = this.data.replies.find((reply) => reply.id === event.currentTarget.dataset.id);
    if (item) return this.showContentActions('communityReply', item.id, item.viewerIsAuthor);
  },
  showActionSheet(itemList) {
    return new Promise((resolve) => wx.showActionSheet({
      itemList,
      success: (result) => resolve(Number.isInteger(result.tapIndex) ? result.tapIndex : -1),
      fail: () => resolve(-1)
    }));
  },
  confirmDelete() {
    this.cancelPendingDelete(false);
    return new Promise((resolve) => {
      this._deleteResolver = resolve;
      this.setData({ modal: modalState({
        visible: true,
        type: 'delete',
        title: '确定删除吗？',
        description: '删除后，这条内容将无法恢复。',
        cancelText: '先留着',
        confirmText: '删除',
        danger: true,
        closeOnMask: false
      }) });
    });
  },
  settleDeleteConfirmation(confirmed, closeModal) {
    const resolve = this._deleteResolver;
    this._deleteResolver = null;
    if (closeModal && !this._disposed) this.setData({ modal: { ...this.data.modal, visible: false, loading: false } });
    if (typeof resolve === 'function') resolve(Boolean(confirmed));
  },
  cancelPendingDelete(updateView) {
    if (updateView && this.data.modal.visible) this.setData({ modal: { ...this.data.modal, visible: false, loading: false } });
    const resolve = this._deleteResolver;
    this._deleteResolver = null;
    if (typeof resolve === 'function') resolve(false);
  },
  handleModalConfirm() {
    if (this.data.modal.loading || !this._deleteResolver) return;
    this.setData({ modal: { ...this.data.modal, loading: true } });
    this.settleDeleteConfirmation(true, false);
  },
  handleModalCancel() {
    if (this.data.modal.loading) return;
    this.settleDeleteConfirmation(false, true);
  },
  handleModalClose() { this.handleModalCancel(); },
  handleModalClosed() {
    const switchCommunity = this._afterDeleteClosed === 'switchCommunity';
    this._afterDeleteClosed = '';
    if (!this._disposed) this.setData({ modal: modalState() });
    if (switchCommunity && !this._disposed) wx.switchTab({ url: '/pages/community/index' });
  },
  async showContentActions(targetType, targetId, isAuthor) {
    const lockKey = `${targetType}:${targetId}`;
    this._actionLocks = this._actionLocks || new Set();
    if (this._disposed || this._actionLocks.has(lockKey)) return;
    this._actionLocks.add(lockKey);
    let operation = '';
    try {
      const selectedIndex = await this.showActionSheet(isAuthor ? ['删除内容', '举报'] : ['举报']);
      if (this._disposed || selectedIndex < 0) return;
      if (isAuthor && selectedIndex === 0) {
        operation = 'delete';
        if (!await this.confirmDelete() || this._disposed) return;
        if (targetType === 'communityPost') {
          await communityService.deletePost(targetId);
          if (!this._disposed) {
            this._afterDeleteClosed = 'switchCommunity';
            this.setData({ modal: { ...this.data.modal, visible: false, loading: false } });
          }
          return;
        }
        const deleted = await communityService.deleteReply(targetId);
        if (!this._disposed) this.setData({
          replies: this.data.replies.filter((item) => item.id !== targetId),
          'post.replyCount': Math.max(0, Number(deleted.replyCount) || 0),
          modal: { ...this.data.modal, visible: false, loading: false },
          ...(this.data.replyTarget && this.data.replyTarget.id === targetId
            ? { replyTarget: null, replyPlaceholder: '写下你的回复…', replyCursorSpacing: 120 }
            : {})
        });
        return;
      }
      operation = 'report';
      if (!await this.ensureInteractionAccess() || this._disposed) return;
      const reasonIndex = await this.showActionSheet(COMMUNITY_REPORT_REASONS.map((item) => item.label));
      const reason = COMMUNITY_REPORT_REASONS[reasonIndex];
      if (!reason || this._disposed) return;
      await safetyService.report({ targetType, targetId, reason: reason.value, description: '' });
      if (!this._disposed) wx.showToast({ title: '已收到举报', icon: 'success' });
    } catch (error) {
      if (!this._disposed && operation === 'delete') this.setData({ modal: { ...this.data.modal, visible: false, loading: false } });
      if (!this._disposed && !error.handled) wx.showToast({ title: operation === 'delete' ? '删除失败，请重试' : '举报失败，请重试', icon: 'none' });
    } finally {
      this._actionLocks.delete(lockKey);
    }
  },
  handleRetryDetail() { return this.loadDetail(false); },
  handleRetryLoadMore() {
    if (this._replyLocatePending) return;
    if (this._targetReplyId && !this._replyLocateSettled && !this._replyLocateStopped) return this.startReplyLocating();
    return this.handleLoadMore();
  },
  async handleLoadMore() {
    if (this._replyLocatePending) return false;
    const loaded = await this.loadDetail(true);
    if (loaded) await this.settleTargetAfterManualAppend();
    return loaded;
  },
  handleBack() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    if (pages.length > 1) return wx.navigateBack({ delta: 1 });
    return wx.switchTab({ url: '/pages/community/index' });
  },
  handleBackToCommunity() { wx.switchTab({ url: '/pages/community/index' }); }
});

module.exports = { decorate, mergeReplies, splitContentSegments, formatCommunityTime };
