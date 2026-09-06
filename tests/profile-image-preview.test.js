'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  profileImagePreviewPath,
  resolvePreviewImagePath,
  PREVIEW_PATHS
} = require('../miniprogram/utils/profile-image-preview');

const ROOT = path.join(__dirname, '../miniprogram/pages/user');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

test('我的页面头像与背景分别打开对应的单图预览', () => {
  const template = read('index.wxml');
  const script = read('index.js');
  const style = read('index.wxss');

  assert.match(template, /class="profile-background-preview"[^>]*bindtap="handleBackgroundPreview"[^>]*aria-label="查看背景大图"/);
  assert.match(template, /class="profile-avatar-shell"[^>]*bindtap="handleAvatarPreview"[^>]*aria-label="查看头像大图"/);
  assert.match(script, /handleAvatarPreview\(\)[\s\S]*profileImagePreviewPath\(this\.data\.profileAvatarPath\)/);
  assert.match(script, /handleBackgroundPreview\(\)[\s\S]*profileImagePreviewPath\(this\.data\.profileCoverPath\)/);
  assert.match(script, /await resolvePreviewImagePath\(imagePath, wx\)/);
  assert.match(script, /wx\.previewImage\(\{[\s\S]*current: resolvedPath,[\s\S]*urls: \[resolvedPath\]/);
  assert.match(script, /if \(this\._isPreviewing \|\| !imagePath/);
  assert.match(script, /if \(this\._disposed \|\| previewSeq !== this\._previewSeq\) return/);
  assert.match(script, /onShow\(\)\s*{\s*this\._disposed = false/);
  assert.match(script, /onHide\(\)[\s\S]*this\.cancelImagePreview\(\)/);
  assert.doesNotMatch(script, /onHide\(\)\s*{\s*this\._disposed = true/);
  assert.match(script, /onUnload\(\)\s*{\s*this\._disposed = true;[\s\S]*this\.cancelImagePreview\(\)/);
  assert.match(style, /\.profile-background-preview\s*{[\s\S]*position:\s*absolute[\s\S]*inset:\s*0/);
  assert.match(style, /\.profile-avatar-shell--pressed/);
});

test('预览资源由WebP白名单映射到原生预览兼容的JPEG', () => {
  for (const [displayPath, previewPath] of Object.entries(PREVIEW_PATHS)) {
    assert.match(displayPath, /\.webp$/);
    assert.match(previewPath, /-preview\.jpg$/);
    assert.equal(profileImagePreviewPath(displayPath), previewPath);
    const absolutePath = path.join(__dirname, '../miniprogram', previewPath);
    const file = fs.readFileSync(absolutePath);
    assert.deepEqual([...file.subarray(0, 3)], [0xff, 0xd8, 0xff]);
    assert.ok(file.length > 1024);
  }
  assert.equal(profileImagePreviewPath('https://cdn.example.com/profile/avatar.jpg'), 'https://cdn.example.com/profile/avatar.jpg');
  assert.equal(profileImagePreviewPath('cloud://pinba/private-profile-avatar/avatar.jpg'), 'cloud://pinba/private-profile-avatar/avatar.jpg');
  assert.equal(profileImagePreviewPath('wxfile://tmp/avatar.jpg'), 'wxfile://tmp/avatar.jpg');
  assert.equal(profileImagePreviewPath('http://example.com/insecure.jpg'), '');
  assert.equal(profileImagePreviewPath('javascript:alert(1)'), '');
});

function createPlatform(overrides = {}) {
  return {
    getFileSystemManager() {
      return {
        access({ success }) { success(); }
      };
    },
    getImageInfo({ src, success }) { success({ path: `wxfile://resolved/${src.split('/').pop()}` }); },
    downloadFile({ success }) { success({ statusCode: 200, tempFilePath: 'wxfile://downloaded/avatar.jpg' }); },
    cloud: {
      downloadFile({ success }) { success({ tempFilePath: 'wxfile://cloud/avatar.jpg' }); }
    },
    ...overrides
  };
}

test('真机预览解析器将包内图片解析并校验为本地路径', async () => {
  let accessed = '';
  const platform = createPlatform({
    getFileSystemManager() {
      return { access({ path: filePath, success }) { accessed = filePath; success(); } };
    }
  });
  const result = await resolvePreviewImagePath('/assets/images/profile/profile-default-cover-preview.jpg', platform);
  assert.equal(result, 'wxfile://resolved/profile-default-cover-preview.jpg');
  assert.equal(accessed, result);
});

test('真机预览解析器下载 cloud 与 https 图片后校验临时路径', async () => {
  const accessed = [];
  const platform = createPlatform({
    getFileSystemManager() {
      return { access({ path: filePath, success }) { accessed.push(filePath); success(); } };
    }
  });
  assert.equal(await resolvePreviewImagePath('cloud://pinba/avatar.jpg', platform), 'wxfile://cloud/avatar.jpg');
  assert.equal(await resolvePreviewImagePath('https://cdn.example.com/avatar.jpg', platform), 'wxfile://downloaded/avatar.jpg');
  assert.deepEqual(accessed, ['wxfile://cloud/avatar.jpg', 'wxfile://downloaded/avatar.jpg']);
});

test('真机预览解析器拒绝失效临时文件和非 2xx 下载', async () => {
  const expiredPlatform = createPlatform({
    getFileSystemManager() {
      return { access({ fail }) { fail(new Error('missing')); } };
    }
  });
  await assert.rejects(() => resolvePreviewImagePath('wxfile://expired/avatar.jpg', expiredPlatform), /PREVIEW_FILE_FAILED/);

  const failedDownloadPlatform = createPlatform({
    downloadFile({ success }) { success({ statusCode: 404, tempFilePath: 'wxfile://404.jpg' }); }
  });
  await assert.rejects(() => resolvePreviewImagePath('https://cdn.example.com/missing.jpg', failedDownloadPlatform), /PREVIEW_DOWNLOAD_FAILED/);

  const invalidTempPathPlatform = createPlatform({
    downloadFile({ success }) { success({ statusCode: 200, tempFilePath: 'https://cdn.example.com/not-local.jpg' }); }
  });
  await assert.rejects(() => resolvePreviewImagePath('https://cdn.example.com/avatar.jpg', invalidTempPathPlatform), /PREVIEW_FILE_UNAVAILABLE/);
  await assert.rejects(() => resolvePreviewImagePath('javascript:alert(1)', createPlatform()), /PREVIEW_SOURCE_UNSUPPORTED/);
});

test('解析失败保留内部原始错误但不改变受控错误码', async () => {
  const originalError = new Error('cloud permission denied');
  const platform = createPlatform({
    cloud: {
      downloadFile({ fail }) { fail(originalError); }
    }
  });
  await assert.rejects(
    () => resolvePreviewImagePath('cloud://pinba/private-avatar.jpg', platform),
    (error) => error.code === 'PREVIEW_CLOUD_FAILED' && error.cause === originalError
  );
});
