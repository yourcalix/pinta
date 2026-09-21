'use strict';

const OPEN_DELAY_MS = 24;
const CLOSE_DURATION_MS = 220;
const IMAGE_LOAD_TIMEOUT_MS = 1600;

Component({
  options: {
    styleIsolation: 'isolated'
  },

  properties: {
    visible: { type: Boolean, value: false, observer: 'handleVisibilityChange' },
    image: { type: String, value: '' },
    stage: { type: String, value: '' },
    title: { type: String, value: '' },
    collecting: { type: Boolean, value: false }
  },

  data: {
    rendered: false,
    opened: false,
    imageLoaded: false
  },

  lifetimes: {
    attached() {
      this._disposed = false;
      this._imageErrorReported = false;
      this._actionPending = false;
      if (this.data.visible) this.open();
    },
    detached() {
      this._disposed = true;
      this.clearTimers();
    }
  },

  methods: {
    clearTimers() {
      if (this._openTimer) clearTimeout(this._openTimer);
      if (this._closeTimer) clearTimeout(this._closeTimer);
      if (this._imageTimer) clearTimeout(this._imageTimer);
      this._openTimer = null;
      this._closeTimer = null;
      this._imageTimer = null;
    },

    handleVisibilityChange(visible) {
      if (this._disposed) return;
      if (visible) this.open();
      else this.close();
    },

    open() {
      this.clearTimers();
      this._imageErrorReported = false;
      this._actionPending = false;
      this.setData({ rendered: true, opened: false, imageLoaded: false });
      this._imageTimer = setTimeout(() => {
        this._imageTimer = null;
        if (!this._disposed && this.data.visible && !this.data.imageLoaded) this.handleImageError();
      }, IMAGE_LOAD_TIMEOUT_MS);
    },

    handleImageLoad() {
      if (this._disposed || !this.data.visible || this.data.imageLoaded) return;
      if (this._imageTimer) clearTimeout(this._imageTimer);
      this._imageTimer = null;
      this.setData({ imageLoaded: true }, () => {
        this._openTimer = setTimeout(() => {
          this._openTimer = null;
          if (!this._disposed && this.data.visible) this.setData({ opened: true });
        }, OPEN_DELAY_MS);
      });
    },

    handleImageError() {
      if (this._disposed || this._imageErrorReported) return;
      this._imageErrorReported = true;
      this.clearTimers();
      this.setData({ rendered: false, opened: false, imageLoaded: false });
      this.triggerEvent('imageerror', { stage: this.data.stage });
    },

    close() {
      if (!this.data.rendered) return;
      if (this._openTimer) clearTimeout(this._openTimer);
      if (this._imageTimer) clearTimeout(this._imageTimer);
      if (this._closeTimer) clearTimeout(this._closeTimer);
      this._openTimer = null;
      this._imageTimer = null;
      this.setData({ opened: false });
      this._closeTimer = setTimeout(() => {
        this._closeTimer = null;
        if (this._disposed || this.data.visible) return;
        this.setData({ rendered: false, imageLoaded: false }, () => {
          if (!this._disposed) this.triggerEvent('closed');
        });
      }, CLOSE_DURATION_MS);
    },

    emitAction(name) {
      if (this._actionPending || this.data.collecting) return;
      this._actionPending = true;
      this.triggerEvent(name, { stage: this.data.stage });
    },

    handleCollect() { this.emitAction('collect'); },
    handleLater() { this.emitAction('later'); },
    handleClose() { this.emitAction('close'); },
    noop() {}
  }
});

module.exports = { OPEN_DELAY_MS, CLOSE_DURATION_MS, IMAGE_LOAD_TIMEOUT_MS };
