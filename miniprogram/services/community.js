'use strict';

const api = require('./api');

module.exports = {
  listPosts: (filters = {}) => api.invoke('community.post.list', filters),
  getPost: (postId, filters = {}) => api.invoke('community.post.detail', { postId, ...filters }),
  createPost: (content) => api.invoke('community.post.create', { content }, { mutating: true }),
  createReply: (postId, content) => api.invoke('community.reply.create', { postId, content }, { mutating: true }),
  deletePost: (postId) => api.invoke('community.post.delete', { postId }, { mutating: true }),
  deleteReply: (replyId) => api.invoke('community.reply.delete', { replyId }, { mutating: true })
};
