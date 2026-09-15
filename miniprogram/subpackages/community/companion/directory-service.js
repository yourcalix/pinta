'use strict';

const api = require('../../../services/api');
const SCENE = 'companion_globe';

module.exports = {
  snapshot: (etag = '') => api.invoke('companion.directory.snapshot', {
    scene: SCENE,
    ...(etag ? { etag } : {})
  }),
  createProfileNavigation: (displayToken) => api.invoke(
    'companion.directory.profile.nav.create',
    { scene: SCENE, displayToken },
    { mutating: true }
  )
};
