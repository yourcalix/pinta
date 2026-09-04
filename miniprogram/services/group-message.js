'use strict';

const api = require('./api');

module.exports = {
  thread: activityId => api.invoke('group.thread', { activityId }),
  list: (activityId, before, limit = 20) => api.invoke('group.message.list', { activityId, before, limit }),
  send: (activityId, generation, clientMessageId, text) => api.invoke(
    'group.message.send',
    { activityId, generation, clientMessageId, text },
    { mutating: true, idempotencyKey: `group_send:${clientMessageId}` }
  ),
  markRead: (activityId, generation, messageId, sequence) => api.invoke(
    'group.message.read',
    { activityId, generation, messageId, sequence },
    { mutating: true }
  )
};
