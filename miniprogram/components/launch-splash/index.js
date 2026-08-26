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
    handleAssetError(event) {
      if (this._assetErrorReported) return;
      this._assetErrorReported = true;
      const dataset = event && event.currentTarget && event.currentTarget.dataset;
      this.triggerEvent('asseterror', { asset: dataset && dataset.asset ? dataset.asset : 'unknown' });
    },
    preventTouchMove() {}
  }
};

if (typeof Component === 'function') Component(definition);

module.exports = definition;
