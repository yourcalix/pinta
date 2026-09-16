'use strict';

const api = require('../../../services/api');

module.exports = {
  get: (profileNavToken) => api.invoke('profile.public.get', { profileNavToken }),
  setFollow: (profileNavToken, following) => api.invoke('profile.follow.set', { profileNavToken, following }, { mutating: true })
};
