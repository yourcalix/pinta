'use strict';

const TOTAL_BLOCKS = 12;
const PRELOAD_BLOCKS = 10;
const STEP_INTERVAL_MS = 320;
const FINISH_GATE_MS = 3800;
const FINISH_INTERVAL_MS = 220;
const DROP_DURATION_MS = 360;
const HOLD_MS = 120;
const FADE_MS = 500;

function createProgressBlocks() {
  return Array.from({ length: TOTAL_BLOCKS }, (_, index) => ({
    id: index + 1,
    x: 24 + index * 34,
    y: 108 - index * 8,
    scale: Number((1 - index * 0.012).toFixed(3)),
    zIndex: TOTAL_BLOCKS - index
  }));
}

module.exports = {
  TOTAL_BLOCKS,
  PRELOAD_BLOCKS,
  STEP_INTERVAL_MS,
  FINISH_GATE_MS,
  FINISH_INTERVAL_MS,
  DROP_DURATION_MS,
  HOLD_MS,
  FADE_MS,
  createProgressBlocks
};
