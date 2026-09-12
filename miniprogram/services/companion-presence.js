'use strict';

const api = require('./api');
const SCENE = 'companion_globe';

module.exports = {
  snapshot: () => api.invoke('companion.presence.snapshot', { scene: SCENE }),
  enter: () => api.invoke('companion.presence.enter', { scene: SCENE }, { mutating: true }),
  heartbeat: (sessionToken) => api.invoke('companion.presence.heartbeat', { scene: SCENE, sessionToken }, { mutating: true }),
  leave: (sessionToken) => api.invoke('companion.presence.leave', { scene: SCENE, sessionToken }, { mutating: true })
};
