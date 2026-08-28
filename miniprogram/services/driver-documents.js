'use strict';

const api = require('./api');
const userService = require('./user');

function chooseImage() {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (result) => resolve(result.tempFiles && result.tempFiles[0]),
      fail: reject
    });
  });
}

async function uploadPrivateDocument(kind) {
  const file = await chooseImage();
  if (!file || !file.tempFilePath) throw new Error('没有选择图片');
  if (Number(file.size) > 5 * 1024 * 1024) throw new Error('单张图片不能超过5MB');
  const prepared = await userService.prepareDriverDocument(kind);
  const upload = prepared && prepared.upload;
  if (!upload || !upload.id || !upload.cloudPath) throw new Error('上传凭据获取失败');
  if (api.isMock()) {
    const document = { uploadId: upload.id, kind, fileID: upload.cloudPath };
    await userService.confirmDriverDocument(document);
    return { uploadId: upload.id };
  }
  if (!wx.cloud || typeof wx.cloud.uploadFile !== 'function') throw new Error('私有上传服务暂不可用');
  const result = await wx.cloud.uploadFile({ cloudPath: upload.cloudPath, filePath: file.tempFilePath });
  if (!result || !result.fileID) throw new Error('图片上传失败');
  await userService.confirmDriverDocument({ uploadId: upload.id, kind, fileID: result.fileID });
  return { uploadId: upload.id };
}

module.exports = { uploadPrivateDocument };
