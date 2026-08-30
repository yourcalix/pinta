'use strict';

const communityService = require('../../../services/community');

Page({
  data: { content: '', remaining: 500, submitting: false, errorMessage: '' },

  handleInput(event) {
    const content = event.detail.value.slice(0, 500);
    this.setData({ content, remaining: 500 - content.length, errorMessage: '' });
  },

  async handleSubmit() {
    const content = this.data.content.trim();
    if (this.data.submitting) return;
    if (content.length < 2) return this.setData({ errorMessage: '请写下至少 2 个字的讨论内容' });
    this.setData({ submitting: true, errorMessage: '' });
    try {
      const result = await communityService.createPost(content);
      wx.redirectTo({ url: `/subpackages/community/detail/index?id=${encodeURIComponent(result.post.id)}` });
    } catch (error) {
      this.setData({ errorMessage: error.handled ? '账号暂时无法使用' : error.message || '发起讨论失败，请重试' });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
