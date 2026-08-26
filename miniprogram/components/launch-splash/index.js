'use strict';

const { createProgressBlocks } = require('../../utils/launch-progress');

const definition = {
  properties: {
    progress: { type: Number, value: 0 },
    exiting: { type: Boolean, value: false }
  },
  data: {
    blocks: createProgressBlocks()
  },
  methods: {
    preventTouchMove() {}
  }
};

if (typeof Component === 'function') Component(definition);

module.exports = definition;
