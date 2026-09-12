'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GESTURE_MODE,
  MIN_SCALE,
  MAX_SCALE,
  beginGesture,
  updateGesture,
  finishGesture,
  cancelGesture,
  visualScaleForZoom
} = require('../miniprogram/subpackages/community/companion/gesture');

const rect = { left: 16, top: 100, width: 320, height: 320 };
const touch = (clientX, clientY) => ({ clientX, clientY });

test('单指拖动按CSS像素旋转，8px以内才保留点击语义', () => {
  let gesture = beginGesture(null, [touch(120, 220)], rect, 1, 100);
  assert.equal(gesture.mode, GESTURE_MODE.DRAGGING);
  let moved = updateGesture(gesture, [touch(126, 224)], 1, 116);
  gesture = moved.gesture;
  assert.equal(moved.rotationDelta > 0, true);
  assert.equal(finishGesture(gesture, [], [touch(126, 224)], 120).action, 'tap');

  gesture = beginGesture(null, [touch(120, 220)], rect, 1, 200);
  moved = updateGesture(gesture, [touch(150, 223)], 1, 216);
  const finished = finishGesture(moved.gesture, [], [touch(150, 223)], 220);
  assert.equal(finished.action, 'inertia');
  assert.equal(finished.angularVelocity > 0, true);
  assert.equal(finishGesture(moved.gesture, [], [touch(150, 223)], 400).action, 'resume');

  gesture = beginGesture(null, [touch(120, 220)], rect, 1, 300);
  assert.notEqual(finishGesture(gesture, [], [touch(150, 220)], 310).action, 'tap');
});

test('左侧28px系统返回区完全旁路球体手势', () => {
  const gesture = beginGesture(null, [touch(24, 220)], rect, 1, 100);
  assert.equal(gesture.mode, GESTURE_MODE.BYPASS);
  assert.equal(updateGesture(gesture, [touch(90, 220)], 1, 116).rotationDelta, 0);
  assert.equal(finishGesture(gesture, [], [touch(90, 220)], 120).action, 'none');
});

test('双指缩放限制在安全范围且任一手指先抬起后不降级为拖动或点击', () => {
  let gesture = beginGesture(null, [touch(100, 200), touch(200, 200)], rect, 1, 100);
  assert.equal(gesture.mode, GESTURE_MODE.PINCHING);
  let moved = updateGesture(gesture, [touch(20, 200), touch(300, 200)], 1, 116);
  assert.equal(moved.scale, MAX_SCALE);
  gesture = finishGesture(moved.gesture, [touch(20, 200)], [touch(300, 200)], 120).gesture;
  assert.equal(gesture.mode, GESTURE_MODE.PINCH_COOLDOWN);
  moved = updateGesture(gesture, [touch(180, 200)], MAX_SCALE, 132);
  assert.equal(moved.rotationDelta, 0);
  assert.equal(finishGesture(moved.gesture, [], [touch(180, 200)], 140).action, 'resume');

  gesture = beginGesture(null, [touch(100, 200), touch(200, 200)], rect, 1, 200);
  moved = updateGesture(gesture, [touch(145, 200), touch(155, 200)], 1, 216);
  assert.equal(moved.scale, MIN_SCALE);
});

test('取消手势不触发点击或惯性，视觉元素使用阻尼缩放', () => {
  const gesture = beginGesture(null, [touch(120, 220)], rect, 1, 100);
  assert.deepEqual(cancelGesture(gesture), { gesture: null, action: 'resume', angularVelocity: 0 });
  assert.equal(visualScaleForZoom(MIN_SCALE) > MIN_SCALE, true);
  assert.equal(visualScaleForZoom(MAX_SCALE) < MAX_SCALE, true);
  assert.equal(visualScaleForZoom(1), 1);
});
