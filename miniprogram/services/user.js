'use strict';

const api = require('./api');
const PROFILE_AVATAR_MAX_BYTES = 1024 * 1024;

async function login() {
  const result = await api.invoke('auth.login');
  api.setActorScope(result.sessionScope);
  const app = getApp();
  if (app.globalData.sessionScope !== result.sessionScope) {
    app.globalData.welcomeHandledCampaigns = {};
  }
  app.globalData.sessionScope = result.sessionScope;
  app.globalData.user = result.user;
  app.globalData.welcome = result.welcome || null;
  return { ...result.user, onboarding: result.onboarding, welcome: result.welcome || null };
}

async function ackWelcome(campaign, variant) {
  const result = await api.invoke('welcome.ack', { campaign, variant }, { mutating: true });
  const app = typeof getApp === 'function' ? getApp() : null;
  if (app && app.globalData) app.globalData.welcome = result.welcome || null;
  return result;
}

async function persistMockAvatar(filePath) {
  if (typeof wx === 'undefined' || !wx.getFileSystemManager) return filePath;
  const manager = wx.getFileSystemManager();
  if (!manager || typeof manager.saveFile !== 'function') return filePath;
  return new Promise((resolve) => manager.saveFile({ filePath, success: (result) => resolve(result.savedFilePath || filePath), fail: () => resolve(filePath) }));
}

async function assertAvatarFileSize(filePath) {
  if (typeof wx === 'undefined' || !wx.getFileSystemManager) return;
  const manager = wx.getFileSystemManager();
  if (!manager || typeof manager.getFileInfo !== 'function') return;
  const size = await new Promise((resolve) => manager.getFileInfo({
    filePath,
    success: (result) => resolve(Number(result.size) || 0),
    fail: () => resolve(0)
  }));
  if (size > PROFILE_AVATAR_MAX_BYTES) throw new Error('头像图片不能超过 1MB');
}

async function uploadAvatar(filePath) {
  await assertAvatarFileSize(filePath);
  const prepared = await api.invoke('profile.avatar.prepare', {}, { mutating: true });
  const upload = prepared.upload;
  let fileID;
  if (api.isMock()) {
    fileID = await persistMockAvatar(filePath);
  } else {
    if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.uploadFile !== 'function') throw new Error('当前环境暂不支持头像上传');
    const result = await wx.cloud.uploadFile({ cloudPath: upload.cloudPath, filePath });
    fileID = result && result.fileID;
  }
  if (!fileID) throw new Error('头像上传失败，请重试');
  return api.invoke('profile.avatar.confirm', { uploadId: upload.id, fileID }, { mutating: true });
}

module.exports = {
  login,
  ackWelcome,
  getProfile: () => api.invoke('profile.get'),
  updateProfile: (profile) => api.invoke('profile.update', profile, { mutating: true }),
  uploadAvatar,
  clearAvatar: () => api.invoke('profile.avatar.clear', {}, { mutating: true }),
  mine: () => api.invoke('activity.mine'),
  notifications: () => api.invoke('notification.list'),
  readNotification: (notificationId) => api.invoke('notification.read', { notificationId }, { mutating: true })
};
