'use strict';

const api = require('../../../services/api');
const SCENE = 'companion_globe';

module.exports = {
  snapshot: () => api.invoke('companion.directory.snapshot', { scene: SCENE }),
  onlineSnapshot: () => api.invoke('companion.presence.snapshot', { scene: SCENE }),
  createProfileNavigation: (displayToken) => api.invoke(
    'companion.directory.profile.nav.create',
    { scene: SCENE, displayToken },
    { mutating: true }
  )
};
