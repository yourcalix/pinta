'use strict';

const EDGE_GESTURE_SAFE_PX = 28;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function resolveCanvasTap(event = {}, rect = {}) {
  const touch = event.changedTouches && event.changedTouches[0]
    || event.touches && event.touches[0]
    || event.detail
    || {};
  const clientX = finite(touch.clientX) ?? finite(touch.x);
  const clientY = finite(touch.clientY) ?? finite(touch.y);
  const left = finite(rect.left) || 0;
  const top = finite(rect.top) || 0;
  if (clientX === null || clientY === null || clientX <= EDGE_GESTURE_SAFE_PX) return null;
  let x = clientX - left;
  let y = clientY - top;
  const width = finite(rect.width);
  const height = finite(rect.height);
  if (width !== null && (x < 0 || x > width) && clientX >= 0 && clientX <= width) x = clientX;
  if (height !== null && (y < 0 || y > height) && clientY >= 0 && clientY <= height) y = clientY;
  if (x < 0 || y < 0 || width !== null && x > width || height !== null && y > height) return null;
  return { x, y, clientX };
}

function pointInBounds(point, bounds) {
  return Boolean(bounds
    && point.x >= bounds.left && point.x <= bounds.right
    && point.y >= bounds.top && point.y <= bounds.bottom);
}

function selectHitNode(point, nodes = []) {
  if (!point) return null;
  const candidates = (Array.isArray(nodes) ? nodes : []).filter((node) => {
    if (!node || !node.displayToken || Number(node.depth) <= .05) return false;
    const dx = point.x - Number(node.screenX);
    const dy = point.y - Number(node.screenY);
    const radius = Math.max(18, Number(node.hitRadius) || 22);
    return dx * dx + dy * dy <= radius * radius || pointInBounds(point, node.textBounds);
  }).map((node) => {
    const dx = point.x - Number(node.screenX);
    const dy = point.y - Number(node.screenY);
    return { node, distance: Math.sqrt(dx * dx + dy * dy) };
  });
  candidates.sort((left, right) => Number(right.node.depth) - Number(left.node.depth) || left.distance - right.distance);
  return candidates.length ? candidates[0].node : null;
}

module.exports = { EDGE_GESTURE_SAFE_PX, resolveCanvasTap, selectHitNode };
