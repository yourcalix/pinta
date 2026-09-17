'use strict';

const REQUIRED_ASSET_COUNT = 6;
const INITIAL_PROGRESS = 12;
const CREEP_LIMIT = 86;
const CREEP_INTERVAL_MS = 300;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const definition = {
  properties: {
    finishing: { type: Boolean, value: false },
    exiting: { type: Boolean, value: false }
  },

  data: {
    assetsReady: false,
    progress: 0,
    runnerLeft: 20
  },

  lifetimes: {
    attached() {
      this._destroyed = false;
      this._assetErrorReported = false;
      this._finishRequested = false;
      this._loadedAssets = new Set();
      this._creepTimer = null;
    },

    detached() {
      this._destroyed = true;
      this.clearCreepTimer();
      this._loadedAssets = null;
    }
  },

  observers: {
    finishing(value) {
      if (!value) return;
      this._finishRequested = true;
      this.beginFinish();
    }
  },

  methods: {
    handleAssetLoad(event) {
      if (this._destroyed || this._assetErrorReported) return;
      const dataset = event && event.currentTarget && event.currentTarget.dataset;
      const asset = dataset && dataset.asset;
      if (!asset) return;
      if (!this._loadedAssets) this._loadedAssets = new Set();
      if (this._loadedAssets.has(asset)) return;

      this._loadedAssets.add(asset);
      if (this._loadedAssets.size < REQUIRED_ASSET_COUNT || this.data.assetsReady) return;

      this.setData({
        assetsReady: true,
        progress: INITIAL_PROGRESS,
        runnerLeft: this.getRunnerLeft(INITIAL_PROGRESS)
      });
      this.triggerEvent('assetsready');

      if (this._finishRequested || this.data.finishing) this.beginFinish();
      else this.startAutoCreep();
    },

    handleAssetError(event) {
      if (this._assetErrorReported) return;
      this._assetErrorReported = true;
      this.clearCreepTimer();
      const dataset = event && event.currentTarget && event.currentTarget.dataset;
      this.triggerEvent('asseterror', { asset: dataset && dataset.asset ? dataset.asset : 'unknown' });
    },

    startAutoCreep(limit = CREEP_LIMIT) {
      this.clearCreepTimer();
      if (this._destroyed || !this.data.assetsReady || this.data.finishing) return;

      const step = () => {
        if (this._destroyed || this.data.finishing || !this.data.assetsReady) return;
        const current = Number(this.data.progress) || 0;
        if (current >= limit) return;
        const remaining = limit - current;
        this.setProgress(Math.min(limit, current + Math.max(0.65, remaining * 0.12)));
        this._creepTimer = setTimeout(step, CREEP_INTERVAL_MS);
      };

      step();
    },

    beginFinish() {
      this.clearCreepTimer();
      if (this._destroyed || !this.data.assetsReady) return;
      this.setProgress(100);
    },

    setProgress(progress) {
      if (this._destroyed) return;
      const safeProgress = clamp(Number(progress) || 0, 0, 100);
      this.setData({
        progress: Number(safeProgress.toFixed(1)),
        runnerLeft: this.getRunnerLeft(safeProgress)
      });
    },

    getRunnerLeft(progress) {
      const safeProgress = clamp(Number(progress) || 0, 0, 100);
      if (safeProgress <= CREEP_LIMIT) {
        return Math.round(20 + (safeProgress / CREEP_LIMIT) * 180);
      }
      return Math.round(200 + ((safeProgress - CREEP_LIMIT) / (100 - CREEP_LIMIT)) * 30);
    },

    clearCreepTimer() {
      if (this._creepTimer) clearTimeout(this._creepTimer);
      this._creepTimer = null;
    },

    preventTouchMove() {}
  }
};

if (typeof Component === 'function') Component(definition);

module.exports = definition;
