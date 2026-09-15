'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mergeSphereNodes,
  nextDirectoryPollDelay
} = require('../miniprogram/subpackages/community/companion/directory-runtime');

function user(layoutSeed, nickname, displayToken) {
  return { layoutSeed, renderKey: `render-${layoutSeed}`, nickname, displayToken, viewerIsSelf: false };
}

test('目录增量合并保留旧节点坐标并只为新用户创建入场状态', () => {
  const original = mergeSphereNodes([], [
    user(101, '小琴', 'token-a'),
    user(202, '阿明', 'token-b')
  ], 1000);
  const coordinates = Object.fromEntries(original.map((item) => [item.layoutSeed, [item.x, item.y, item.z]]));

  const merged = mergeSphereNodes(original, [
    user(101, '小琴新昵称', 'token-a-next'),
    user(202, '阿明', 'token-b-next'),
    user(303, '新搭子', 'token-c')
  ], 2000);

  assert.deepEqual([merged[0].x, merged[0].y, merged[0].z], coordinates[101]);
  assert.deepEqual([merged[1].x, merged[1].y, merged[1].z], coordinates[202]);
  assert.equal(merged[0].displayToken, 'token-a-next');
  assert.equal(merged[0].nickname, '小琴新昵称');
  assert.equal(merged[0].enteredAt, 1000);
  assert.equal(merged[2].enteredAt, 2000);
  assert.equal(merged.every((item) => Number.isFinite(item.x) && Number.isFinite(item.y) && Number.isFinite(item.z)), true);
});

test('稳定渲染标识防止布局种子碰撞合并错人', () => {
  const original = mergeSphereNodes([], [
    { ...user(101, '同名搭子', 'token-a'), renderKey: 'render-a' },
    { ...user(101, '同名搭子', 'token-b'), renderKey: 'render-b' }
  ], 1000);
  const merged = mergeSphereNodes(original, [
    { ...user(101, '搭子A', 'token-a-next'), renderKey: 'render-a' },
    { ...user(101, '搭子B', 'token-b-next'), renderKey: 'render-b' }
  ], 2000);

  assert.notEqual(merged[0].nodeKey, merged[1].nodeKey);
  assert.equal(merged[0].enteredAt, 1000);
  assert.equal(merged[1].enteredAt, 1000);
  assert.equal(merged[0].nickname, '搭子A');
  assert.equal(merged[1].nickname, '搭子B');
});

test('目录轮询在快速期、稳定期与失败后按阶梯调度', () => {
  assert.equal(nextDirectoryPollDelay({ elapsedMs: 0, failureCount: 0 }), 9000);
  assert.equal(nextDirectoryPollDelay({ elapsedMs: 60_001, failureCount: 0 }), 18000);
  assert.equal(nextDirectoryPollDelay({ elapsedMs: 0, failureCount: 1 }), 10000);
  assert.equal(nextDirectoryPollDelay({ elapsedMs: 0, failureCount: 2 }), 20000);
  assert.equal(nextDirectoryPollDelay({ elapsedMs: 0, failureCount: 3 }), 40000);
  assert.equal(nextDirectoryPollDelay({ elapsedMs: 0, failureCount: 8 }), 60000);
});
