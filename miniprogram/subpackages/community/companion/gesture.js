'use strict';

const GESTURE_MODE = Object.freeze({
  DRAGGING: 'DRAGGING',
  PINCHING: 'PINCHING',
  PINCH_COOLDOWN: 'PINCH_COOLDOWN',
  BYPASS: 'BYPASS'
});
const EDGE_GESTURE_SAFE_PX = 28;
const TAP_DISTANCE_PX = 8;
const MIN_SCALE = .72;
const MAX_SCALE = 1.55;
const ROTATION_RADIANS_PER_PX = .0055;
const MAX_INERTIA_RADIANS_PER_FRAME = .04;
const FRAME_MS = 1000 / 60;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function point(touch) {
  return { clientX: finite(touch && touch.clientX), clientY: finite(touch && touch.clientY) };
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function touchDistance(touches) {
  if (!touches || touches.length < 2) return 0;
  const first = point(touches[0]);
  const second = point(touches[1]);
  return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
}

function pinchGesture(touches, scale) {
  return {
    mode: GESTURE_MODE.PINCHING,
    pinchStartDistance: Math.max(1, touchDistance(touches)),
    pinchStartScale: clamp(finite(scale) || 1, MIN_SCALE, MAX_SCALE),
    maxDistance: TAP_DISTANCE_PX + 1,
    angularVelocity: 0
  };
}

function beginGesture(current, touches, rect, scale, now) {
  if (!touches || !touches.length) return current || null;
  if (current && [GESTURE_MODE.BYPASS, GESTURE_MODE.PINCH_COOLDOWN].includes(current.mode)) return current;
  if (current && current.mode === GESTURE_MODE.DRAGGING && touches.length >= 2) return pinchGesture(touches, scale);
  if (current && current.mode === GESTURE_MODE.PINCHING) return current;
  const first = point(touches[0]);
  if (first.clientX <= EDGE_GESTURE_SAFE_PX) return { mode: GESTURE_MODE.BYPASS };
  if (touches.length >= 2) return pinchGesture(touches, scale);
  return {
    mode: GESTURE_MODE.DRAGGING,
    startX: first.clientX,
    startY: first.clientY,
    lastX: first.clientX,
    lastY: first.clientY,
    lastAt: finite(now),
    maxDistance: 0,
    angularVelocity: 0,
    canvasLeft: finite(rect && rect.left),
    canvasTop: finite(rect && rect.top)
  };
}

function updateGesture(gesture, touches, scale, now) {
  const unchanged = { gesture, rotationDelta: 0, scale: clamp(finite(scale) || 1, MIN_SCALE, MAX_SCALE) };
  if (!gesture || gesture.mode === GESTURE_MODE.BYPASS || gesture.mode === GESTURE_MODE.PINCH_COOLDOWN) return unchanged;
  if (gesture.mode === GESTURE_MODE.DRAGGING && touches && touches.length >= 2) {
    return { ...unchanged, gesture: pinchGesture(touches, scale) };
  }
  if (gesture.mode === GESTURE_MODE.PINCHING) {
    if (!touches || touches.length < 2) return { ...unchanged, gesture: { ...gesture, mode: GESTURE_MODE.PINCH_COOLDOWN } };
    const ratio = touchDistance(touches) / Math.max(1, gesture.pinchStartDistance);
    return { ...unchanged, scale: clamp(gesture.pinchStartScale * ratio, MIN_SCALE, MAX_SCALE) };
  }
  if (!touches || touches.length !== 1) return unchanged;
  const current = point(touches[0]);
  const dx = current.clientX - gesture.lastX;
  const elapsed = Math.max(1, finite(now) - gesture.lastAt);
  const rotationDelta = dx * ROTATION_RADIANS_PER_PX;
  const angularVelocity = clamp(rotationDelta * FRAME_MS / elapsed, -MAX_INERTIA_RADIANS_PER_FRAME, MAX_INERTIA_RADIANS_PER_FRAME);
  const maxDistance = Math.max(gesture.maxDistance, Math.hypot(current.clientX - gesture.startX, current.clientY - gesture.startY));
  return {
    gesture: {
      ...gesture,
      lastX: current.clientX,
      lastY: current.clientY,
      lastAt: finite(now),
      maxDistance,
      angularVelocity
    },
    rotationDelta,
    scale: unchanged.scale
  };
}

function finishGesture(gesture, remainingTouches, changedTouches, now = Date.now()) {
  if (!gesture) return { gesture: null, action: 'none', angularVelocity: 0 };
  const remaining = remainingTouches ? remainingTouches.length : 0;
  if (gesture.mode === GESTURE_MODE.BYPASS) {
    return { gesture: remaining ? gesture : null, action: 'none', angularVelocity: 0 };
  }
  if ([GESTURE_MODE.PINCHING, GESTURE_MODE.PINCH_COOLDOWN].includes(gesture.mode)) {
    if (remaining) return { gesture: { ...gesture, mode: GESTURE_MODE.PINCH_COOLDOWN }, action: 'none', angularVelocity: 0 };
    return { gesture: null, action: 'resume', angularVelocity: 0 };
  }
  if (remaining) return { gesture, action: 'none', angularVelocity: 0 };
  const ended = changedTouches && changedTouches.length ? point(changedTouches[0]) : null;
  const endDistance = ended ? Math.hypot(ended.clientX - gesture.startX, ended.clientY - gesture.startY) : 0;
  const maxDistance = Math.max(gesture.maxDistance, endDistance);
  if (maxDistance <= TAP_DISTANCE_PX && ended) {
    return { gesture: null, action: 'tap', touch: point(changedTouches[0]), angularVelocity: 0 };
  }
  const angularVelocity = finite(now) - gesture.lastAt > 80 ? 0 : gesture.angularVelocity;
  return {
    gesture: null,
    action: Math.abs(angularVelocity) >= .001 ? 'inertia' : 'resume',
    angularVelocity
  };
}

function cancelGesture() {
  return { gesture: null, action: 'resume', angularVelocity: 0 };
}

function visualScaleForZoom(scale) {
  return Math.pow(clamp(finite(scale) || 1, MIN_SCALE, MAX_SCALE), .4);
}

module.exports = {
  GESTURE_MODE,
  EDGE_GESTURE_SAFE_PX,
  TAP_DISTANCE_PX,
  MIN_SCALE,
  MAX_SCALE,
  ROTATION_RADIANS_PER_PX,
  MAX_INERTIA_RADIANS_PER_FRAME,
  beginGesture,
  updateGesture,
  finishGesture,
  cancelGesture,
  visualScaleForZoom
};
