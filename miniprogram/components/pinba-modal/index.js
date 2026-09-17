'use strict';

const TYPE_IMAGES = Object.freeze({
  success: '/assets/images/brand-modal/success.png',
  food: '/assets/images/brand-modal/food.png',
  sport: '/assets/images/brand-modal/sport.png',
  order: '/assets/images/brand-modal/order.png',
  travel: '/assets/images/brand-modal/travel.png',
  location: '/assets/images/brand-modal/location.png',
  delete: '/assets/images/brand-modal/delete.png',
  network: '/assets/images/brand-modal/network.png'
});

const CLOSE_DURATION_MS = 220;

function resolvedImage(type, image) {
  const custom = String(image || '').trim();
  return custom || TYPE_IMAGES[type] || TYPE_IMAGES.success;
}

Component({
  options: {
    styleIsolation: 'isolated'
  },

  properties: {
    visible: { type: Boolean, value: false, observer: 'handleVisibilityChange' },
    type: { type: String, value: 'success', observer: 'handleImageChange' },
    title: { type: String, value: '' },
    description: { type: String, value: '' },
    confirmText: { type: String, value: '知道了' },
    cancelText: { type: String, value: '' },
    danger: { type: Boolean, value: false },
    loading: { type: Boolean, value: false },
    closeOnMask: { type: Boolean, value: true },
    image: { type: String, value: '', observer: 'handleImageChange' }
  },

  data: {
    rendered: false,
    opened: false,
    imageSrc: TYPE_IMAGES.success
  },

  lifetimes: {
    attached() {
      this._disposed = false;
      this.setData({ imageSrc: resolvedImage(this.data.type, this.data.image) });
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
      this._openTimer = null;
      this._closeTimer = null;
    },

    handleVisibilityChange(visible) {
      if (this._disposed) return;
      if (visible) this.open();
      else this.close();
    },

    handleImageChange() {
      if (this._disposed) return;
      this.setData({ imageSrc: resolvedImage(this.data.type, this.data.image) });
    },

    open() {
      this.clearTimers();
      const imageSrc = resolvedImage(this.data.type, this.data.image);
      this.setData({ rendered: true, opened: false, imageSrc }, () => {
        if (this._disposed || !this.data.visible) return;
        this._openTimer = setTimeout(() => {
          this._openTimer = null;
          if (!this._disposed && this.data.visible) this.setData({ opened: true });
        }, 24);
      });
    },

    close() {
      if (!this.data.rendered) return;
      if (this._openTimer) clearTimeout(this._openTimer);
      if (this._closeTimer) clearTimeout(this._closeTimer);
      this._openTimer = null;
      this.setData({ opened: false });
      this._closeTimer = setTimeout(() => {
        this._closeTimer = null;
        if (this._disposed || this.data.visible) return;
        this.setData({ rendered: false }, () => {
          if (!this._disposed) this.triggerEvent('closed');
        });
      }, CLOSE_DURATION_MS);
    },

    handleMaskTap() {
      if (this.data.loading || this.data.danger || !this.data.closeOnMask) return;
      this.triggerEvent('close', { source: 'mask' });
    },

    handleCancel() {
      if (this.data.loading) return;
      this.triggerEvent('cancel');
    },

    handleConfirm() {
      if (this.data.loading) return;
      this.triggerEvent('confirm');
    },

    noop() {}
  }
});

module.exports = { TYPE_IMAGES, CLOSE_DURATION_MS, resolvedImage };
