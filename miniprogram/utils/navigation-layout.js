'use strict';

const DEFAULT_STATUS_BAR_HEIGHT = 20;
const DEFAULT_NAVIGATION_HEIGHT = 44;
const CONTENT_GAP = 8;

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function calculateContentTopInset(platform) {
  let statusBarHeight = DEFAULT_STATUS_BAR_HEIGHT;
  try {
    const windowInfo = platform && typeof platform.getWindowInfo === 'function'
      ? platform.getWindowInfo()
      : null;
    statusBarHeight = positiveNumber(windowInfo && windowInfo.statusBarHeight, DEFAULT_STATUS_BAR_HEIGHT);
  } catch (error) {
    statusBarHeight = DEFAULT_STATUS_BAR_HEIGHT;
  }

  let menuRect = null;
  try {
    menuRect = platform && typeof platform.getMenuButtonBoundingClientRect === 'function'
      ? platform.getMenuButtonBoundingClientRect()
      : null;
  } catch (error) {
    menuRect = null;
  }

  const top = Number(menuRect && menuRect.top);
  const bottom = Number(menuRect && menuRect.bottom);
  const validMenuRect = Number.isFinite(top)
    && Number.isFinite(bottom)
    && top >= statusBarHeight
    && bottom > top;
  if (validMenuRect) {
    return Math.round(bottom + (top - statusBarHeight) + CONTENT_GAP);
  }
  return Math.round(statusBarHeight + DEFAULT_NAVIGATION_HEIGHT + CONTENT_GAP);
}

module.exports = {
  DEFAULT_STATUS_BAR_HEIGHT,
  DEFAULT_NAVIGATION_HEIGHT,
  CONTENT_GAP,
  calculateContentTopInset
};
