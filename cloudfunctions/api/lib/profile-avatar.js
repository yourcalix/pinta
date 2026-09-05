'use strict';

const { AppError, invariant } = require('./errors');

const PROFILE_AVATAR_MAX_BYTES = 1024 * 1024;
const PROFILE_AVATAR_MIN_SIDE = 128;
const PROFILE_AVATAR_MAX_SIDE = 2048;

function jpegDimensions(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  return null;
}

function inspectProfileAvatar(buffer) {
  invariant(Buffer.isBuffer(buffer) && buffer.length > 0, 'PROFILE_AVATAR_INVALID', '头像图片读取失败，请重新选择');
  invariant(buffer.length <= PROFILE_AVATAR_MAX_BYTES, 'PROFILE_AVATAR_INVALID', '头像图片不能超过1MB');
  let format;
  let contentType;
  let dimensions;
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    format = 'png';
    contentType = 'image/png';
    dimensions = { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  } else if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    format = 'jpg';
    contentType = 'image/jpeg';
    dimensions = jpegDimensions(buffer);
  }
  invariant(format && dimensions, 'PROFILE_AVATAR_INVALID', '头像仅支持 JPEG 或 PNG 图片');
  const { width, height } = dimensions;
  invariant(width >= PROFILE_AVATAR_MIN_SIDE && height >= PROFILE_AVATAR_MIN_SIDE, 'PROFILE_AVATAR_INVALID', '头像尺寸至少为128×128');
  invariant(width <= PROFILE_AVATAR_MAX_SIDE && height <= PROFILE_AVATAR_MAX_SIDE, 'PROFILE_AVATAR_INVALID', '头像尺寸不能超过2048×2048');
  invariant(width <= height * 3 && height <= width * 3, 'PROFILE_AVATAR_INVALID', '头像图片比例不合适');
  return { format, contentType, width, height, byteLength: buffer.length };
}

function safeSelfAvatar(avatar) {
  if (!avatar || avatar.status !== 'ACTIVE' || typeof avatar.fileID !== 'string') return null;
  return {
    fileID: avatar.fileID,
    revision: Math.max(1, Number(avatar.revision) || 1),
    updatedAt: avatar.updatedAt || null,
    ...(avatar.mockOnly === true ? { mockOnly: true } : {})
  };
}

module.exports = { PROFILE_AVATAR_MAX_BYTES, inspectProfileAvatar, safeSelfAvatar };
