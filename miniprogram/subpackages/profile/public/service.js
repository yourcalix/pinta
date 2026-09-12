'use strict';

const api = require('../../../services/api');

module.exports = {
  get: (profileNavToken) => api.invoke('profile.public.get', { profileNavToken })
};
