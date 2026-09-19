'use strict';

const api = require('./api');

const TYPES = Object.freeze(['FOLLOWING', 'FOLLOWERS']);

function list(type, cursor = '', limit = 20) {
  if (!TYPES.includes(type)) return Promise.reject(new Error('关注列表类型无效'));
  const payload = { type, limit };
  if (cursor) payload.cursor = cursor;
  return api.invoke('profile.follow.list', payload);
}

module.exports = { TYPES, list };
