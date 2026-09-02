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
