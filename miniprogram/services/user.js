'use strict';

const api = require('./api');

async function login() {
  const result = await api.invoke('auth.login');
  api.setActorScope(result.sessionScope);
  getApp().globalData.user = result.user;
  return result.user;
}

module.exports = {
  login,
  getProfile: () => api.invoke('profile.get'),
  updateProfile: (profile) => api.invoke('profile.update', profile, { mutating: true }),
  mine: () => api.invoke('activity.mine'),
  notifications: () => api.invoke('notification.list'),
  readNotification: (notificationId) => api.invoke('notification.read', { notificationId }, { mutating: true })
};
