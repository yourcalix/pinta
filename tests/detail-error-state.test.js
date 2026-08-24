'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveDetailError } = require('../miniprogram/utils/detail-error');

test('详情错误映射把 TAKEDOWN 标记为不可恢复状态', () => {
  assert.deepEqual(resolveDetailError({
    code: 'TAKEDOWN',
    message: '不应直接依赖服务端文案'
  }), {
    errorCode: 'TAKEDOWN',
    error: '该活动已被平台处理，暂不可查看'
  });
});

test('详情错误映射为超时和不存在提供安全可恢复文案', () => {
  assert.deepEqual(resolveDetailError({ code: 'TIMEOUT' }), {
    errorCode: 'TIMEOUT',
    error: '网络请求超时，请重试'
  });
  assert.deepEqual(resolveDetailError({ code: 'NOT_FOUND' }), {
    errorCode: 'NOT_FOUND',
    error: '活动不存在或已失效'
  });
});

test('详情错误映射不会把未知 SDK 原始错误展示给用户', () => {
  const result = resolveDetailError(new Error('raw cloud sdk stack and environment details'));
  assert.deepEqual(result, {
    errorCode: 'UNKNOWN',
    error: '活动加载失败，请稍后重试'
  });
  assert.equal(JSON.stringify(result).includes('cloud sdk'), false);
});

test('详情页把下架、可恢复错误和正常内容保持为互斥分支', () => {
  const pageDir = path.join(__dirname, '../miniprogram/subpackages/activity/detail');
  const script = fs.readFileSync(path.join(pageDir, 'index.js'), 'utf8');
  const template = fs.readFileSync(path.join(pageDir, 'index.wxml'), 'utf8');
  const emptyStateStyle = fs.readFileSync(
    path.join(__dirname, '../miniprogram/components/empty-state/index.wxss'),
    'utf8'
  );

  const permanentBranch = template.indexOf(
    `wx:elif="{{errorCode === 'TAKEDOWN' || errorCode === 'NOT_FOUND'}}"`
  );
  const retryBranch = template.indexOf('wx:elif="{{errorCode}}"');
  const activityBranch = template.indexOf('wx:elif="{{activity}}"');
  assert.ok(permanentBranch > -1 && retryBranch > permanentBranch && activityBranch > retryBranch);
  assert.match(template.slice(permanentBranch, retryBranch), /bindaction="handleGoDiscover"/);
  assert.doesNotMatch(template.slice(permanentBranch, retryBranch), /bindaction="loadDetail"/);
  assert.match(script, /activity:\s*null,[\s\S]*detailRows:\s*\[\]/);
  assert.match(script, /loadSeq\s*!==\s*this\._loadSeq/);
  assert.match(script, /wx\.switchTab\(\{\s*url:\s*'\/pages\/discover\/index'/);
  assert.match(emptyStateStyle, /\.empty-action\s*\{[\s\S]*min-height:\s*88rpx/);
});
