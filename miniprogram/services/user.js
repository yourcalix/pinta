'use strict';

const api = require('./api');

async function login() {
  const result = await api.invoke('auth.login');
  api.setActorScope(result.sessionScope);
  getApp().globalData.user = result.user;
  return { ...result.user, onboarding: result.onboarding };
}

module.exports = {
  login,
  getProfile: () => api.invoke('profile.get'),
  updateProfile: (profile) => api.invoke('profile.update', profile, { mutating: true }),
  selectRole: (roleIntent) => api.invoke('onboarding.selectRole', { roleIntent }, { mutating: true }),
  getDriverApplication: () => api.invoke('driver.application.get'),
  prepareDriverDocument: (kind) => api.invoke('driver.document.prepare', { kind }, { mutating: true }),
  confirmDriverDocument: (document) => api.invoke('driver.document.confirm', document, { mutating: true }),
  submitDriverApplication: (payload) => api.invoke('driver.application.submit', payload, { mutating: true }),
  withdrawDriverApplication: () => api.invoke('driver.application.withdraw', {}, { mutating: true }),
  mine: () => api.invoke('activity.mine'),
  notifications: () => api.invoke('notification.list'),
  readNotification: (notificationId) => api.invoke('notification.read', { notificationId }, { mutating: true })
};
