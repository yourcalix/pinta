'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../miniprogram');
const TRANSPARENT_ASSETS = [
  'assets/images/publish/publish-cover-companion.png',
  'assets/images/publish/publish-cover-sport.png',
  'assets/images/publish/publish-cover-food.png',
  'assets/images/publish/publish-draft-avatar.png',
  'assets/images/profile/profile-avatar-male-painted.png',
  'assets/images/profile/profile-avatar-female-painted.png',
  'assets/images/profile/profile-avatar-neutral-painted.png'
];
const JPEG_ASSETS = [
  'assets/images/profile/profile-default-cover.jpg',
  'assets/images/shared/shared-paper-bg.jpg'
];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolutePath) : [absolutePath];
  });
}

function pngTransparencyLevels(buffer) {
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    if (type === 'tRNS') return new Set(buffer.subarray(offset + 8, offset + 8 + length)).size;
    offset += 12 + length;
  }
  return 0;
}

function jpegFrameMarker(buffer) {
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    if (marker === 0xc0 || marker === 0xc2) return marker;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) break;
    offset += 2 + length;
  }
  return null;
}

test('真机运行时静态资源不再包含或引用 WebP', () => {
  const files = walk(ROOT);
  assert.deepEqual(files.filter((file) => file.endsWith('.webp')), []);
  for (const file of files.filter((item) => /\.(js|json|wxml|wxss)$/.test(item))) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /\.webp\b/, path.relative(ROOT, file));
  }
});

test('透明活动插画与头像使用保留多级 Alpha 的 PNG', () => {
  for (const relativePath of TRANSPARENT_ASSETS) {
    const buffer = fs.readFileSync(path.join(ROOT, relativePath));
    assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], relativePath);
    assert.ok(pngTransparencyLevels(buffer) > 2, `${relativePath} 未保留多级透明度`);
    assert.ok(buffer.length <= 100 * 1024, `${relativePath} 超过 100KB：${buffer.length}`);
  }
});

test('个人背景与共享纸纹使用非渐进式 Baseline JPEG', () => {
  for (const relativePath of JPEG_ASSETS) {
    const buffer = fs.readFileSync(path.join(ROOT, relativePath));
    assert.deepEqual([...buffer.subarray(0, 3)], [0xff, 0xd8, 0xff], relativePath);
    assert.equal(jpegFrameMarker(buffer), 0xc0, `${relativePath} 不是 Baseline JPEG`);
    assert.ok(buffer.length <= 200 * 1024, `${relativePath} 超过 200KB：${buffer.length}`);
  }
});
