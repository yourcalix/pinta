'use strict';

const PREVIEW_PATHS = Object.freeze({
  '/assets/images/profile/profile-default-cover.jpg': '/assets/images/profile/profile-default-cover.jpg',
  '/assets/images/profile/profile-avatar-male-painted.png': '/assets/images/profile/profile-avatar-male-painted.png',
  '/assets/images/profile/profile-avatar-female-painted.png': '/assets/images/profile/profile-avatar-female-painted.png',
  '/assets/images/profile/profile-avatar-neutral-painted.png': '/assets/images/profile/profile-avatar-neutral-painted.png'
});
const PREVIEW_ASSETS = new Set(Object.values(PREVIEW_PATHS));
const DEFAULT_TIMEOUT_MS = 8000;

function previewError(code, cause) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function invokeWithTimeout(executor, timeoutMs, timeoutCode) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => finish(reject, previewError(timeoutCode)), timeoutMs);
    try {
      executor(
        (value) => finish(resolve, value),
        (error) => finish(reject, previewError(timeoutCode.replace('_TIMEOUT', '_FAILED'), error))
      );
    } catch (error) {
      finish(reject, previewError(timeoutCode.replace('_TIMEOUT', '_FAILED'), error));
    }
  });
}

function profileImagePreviewPath(displayPath) {
  if (typeof displayPath !== 'string' || !displayPath) return '';
  if (PREVIEW_ASSETS.has(displayPath)) return displayPath;
  if (/^(https:\/\/|cloud:\/\/|wxfile:\/\/|http:\/\/(tmp|usr)\/|\/tmp\/|\/var\/)/.test(displayPath)) return displayPath;
  return PREVIEW_PATHS[displayPath] || '';
}

function isLocalPreviewPath(filePath) {
  return typeof filePath === 'string'
    && /^(wxfile:\/\/|http:\/\/(tmp|usr)\/|\/tmp\/|\/var\/)/.test(filePath);
}

function assertLocalFile(platform, filePath, timeoutMs) {
  if (!platform || typeof platform.getFileSystemManager !== 'function' || !isLocalPreviewPath(filePath)) {
    return Promise.reject(previewError('PREVIEW_FILE_UNAVAILABLE'));
  }
  const manager = platform.getFileSystemManager();
  if (!manager || typeof manager.access !== 'function') {
    return Promise.reject(previewError('PREVIEW_FILE_UNAVAILABLE'));
  }
  return invokeWithTimeout((resolve, reject) => {
    manager.access({ path: filePath, success: () => resolve(filePath), fail: reject });
  }, timeoutMs, 'PREVIEW_FILE_TIMEOUT');
}

async function resolvePreviewImagePath(rawPath, platform, options = {}) {
  const source = profileImagePreviewPath(rawPath);
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  if (!source || !platform) throw previewError('PREVIEW_SOURCE_UNSUPPORTED');

  if (source.startsWith('cloud://')) {
    if (!platform.cloud || typeof platform.cloud.downloadFile !== 'function') {
      throw previewError('PREVIEW_CLOUD_UNAVAILABLE');
    }
    const result = await invokeWithTimeout((resolve, reject) => {
      platform.cloud.downloadFile({ fileID: source, success: resolve, fail: reject });
    }, timeoutMs, 'PREVIEW_CLOUD_TIMEOUT');
    return assertLocalFile(platform, result && result.tempFilePath, timeoutMs);
  }

  if (source.startsWith('https://')) {
    if (typeof platform.downloadFile !== 'function') throw previewError('PREVIEW_DOWNLOAD_UNAVAILABLE');
    const result = await invokeWithTimeout((resolve, reject) => {
      platform.downloadFile({ url: source, success: resolve, fail: reject });
    }, timeoutMs, 'PREVIEW_DOWNLOAD_TIMEOUT');
    if (!result || result.statusCode < 200 || result.statusCode >= 300 || !result.tempFilePath) {
      throw previewError('PREVIEW_DOWNLOAD_FAILED');
    }
    return assertLocalFile(platform, result.tempFilePath, timeoutMs);
  }

  if (isLocalPreviewPath(source)) {
    return assertLocalFile(platform, source, timeoutMs);
  }

  if (PREVIEW_ASSETS.has(source)) {
    return source;
  }

  throw previewError('PREVIEW_SOURCE_UNSUPPORTED');
}

module.exports = {
  PREVIEW_PATHS,
  profileImagePreviewPath,
  resolvePreviewImagePath
};
