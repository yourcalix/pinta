'use strict';

const communityService = require('../../../services/community');
const userService = require('../../../services/user');
const safetyService = require('../../../services/safety');

const AVATAR_PATHS = {
  PASSENGER_A: '../../../assets/images/discover/avatar-passenger-a.png',
  PASSENGER_B: '../../../assets/images/discover/avatar-passenger-b.png'
};
const REPORT_REASONS = [
  { label: '虚假或误导信息', value: 'FALSE_INFORMATION' },
  { label: '诈骗或广告导流', value: 'FRAUD_OR_DIVERSION' },
  { label: '骚扰或不当内容', value: 'HARASSMENT' },
  { label: '其他问题', value: 'OTHER' }
];

function decorate(item) {
  return { ...item, avatarPath: AVATAR_PATHS[item.author && item.author.avatarKind] || AVATAR_PATHS.PASSENGER_A };
}

Page({
  data: { postId: '', post: null, replies: [], replyContent: '', submitting: false, loading: true, error: '' },

  onLoad(options) {
    this.setData({ postId: options.id || '' });
    return this.loadDetail();
  },

  onUnload() { this._loadSeq = (this._loadSeq || 0) + 1; },

  async loadDetail() {
    const seq = (this._loadSeq = (this._loadSeq || 0) + 1);
    this.setData({ loading: true, error: '' });
    try {
      const result = await communityService.getPost(this.data.postId, { limit: 30 });
      if (seq !== this._loadSeq) return;
      this.setData({ post: decorate(result.post), replies: (result.replies || []).map(decorate), loading: false });
    } catch (error) {
      if (seq === this._loadSeq) this.setData({ loading: false, error: error.message || '讨论暂时无法查看' });
    }
  },

  handleReplyInput(event) { this.setData({ replyContent: event.detail.value.slice(0, 300) }); },

  async handleSendReply() {
    const content = this.data.replyContent.trim();
    if (!content || this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      const user = await userService.login();
      if (!user.profileComplete) {
        wx.navigateTo({ url: `/subpackages/profile/edit/index?next=${encodeURIComponent(`/subpackages/community/detail/index?id=${this.data.postId}`)}` });
        return;
      }
      const result = await communityService.createReply(this.data.postId, content);
      this.setData({ replyContent: '', replies: [...this.data.replies, decorate(result.reply)], 'post.replyCount': Number(this.data.post.replyCount || 0) + 1 });
    } catch (error) {
      if (!error.handled) wx.showToast({ title: error.message || '回复失败，请重试', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  handlePostMore() { this.showContentActions('communityPost', this.data.post.id, this.data.post.viewerIsAuthor); },
  handleReplyMore(event) {
    const item = this.data.replies[event.currentTarget.dataset.index];
    if (item) this.showContentActions('communityReply', item.id, item.viewerIsAuthor);
  },

  showContentActions(targetType, targetId, isAuthor) {
    if (isAuthor) {
      wx.showActionSheet({
        itemList: ['删除内容'],
        success: () => this.confirmDelete(targetType, targetId)
      });
      return;
    }
    wx.showActionSheet({
      itemList: REPORT_REASONS.map((item) => item.label),
      success: (result) => this.reportContent(targetType, targetId, REPORT_REASONS[result.tapIndex].value)
    });
  },

  confirmDelete(targetType, targetId) {
    wx.showModal({
      title: '确认删除',
      content: '删除后其他用户将无法再查看，且无法恢复。',
      confirmText: '删除',
      confirmColor: '#E5484D',
      success: async (result) => {
        if (!result.confirm) return;
        try {
          if (targetType === 'communityPost') {
            await communityService.deletePost(targetId);
            wx.navigateBack();
          } else {
            await communityService.deleteReply(targetId);
            this.setData({ replies: this.data.replies.filter((item) => item.id !== targetId), 'post.replyCount': Math.max(0, Number(this.data.post.replyCount || 0) - 1) });
          }
        } catch (error) { wx.showToast({ title: error.message || '删除失败', icon: 'none' }); }
      }
    });
  },

  async reportContent(targetType, targetId, reason) {
    try {
      await userService.login();
      await safetyService.report({ targetType, targetId, reason, description: '' });
      wx.showToast({ title: '已收到举报', icon: 'success' });
    } catch (error) {
      if (!error.handled) wx.showToast({ title: error.message || '举报失败', icon: 'none' });
    }
  }
});
