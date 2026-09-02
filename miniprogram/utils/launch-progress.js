'use strict';

const TOTAL_BLOCKS = 4;
const PRELOAD_BLOCKS = 3;
const STEP_INTERVAL_MS = 350;
const FINISH_GATE_MS = 1200;
const FINISH_INTERVAL_MS = 0;
const DROP_DURATION_MS = 350;
const HOLD_MS = 300;
const FADE_MS = 300;
const MAX_SPLASH_WAIT_MS = 4500;

function createProgressBlocks() {
  return Array.from({ length: TOTAL_BLOCKS }, (_, index) => ({
    id: index + 1,
    key: ['top-left', 'bottom-left', 'bottom-right', 'top-right'][index],
    color: ['#16A36A', '#2EBD85', '#5CD19E', '#8EE3B8'][index],
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
  MAX_SPLASH_WAIT_MS,
  createProgressBlocks
};
