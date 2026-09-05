'use strict';

const { fallbackAvatarSlot } = require('../../utils/passenger-avatar');

const COVERS = Object.freeze({
  companion: '/assets/images/publish/publish-cover-companion.webp',
  sport: '/assets/images/publish/publish-cover-sport.webp',
  food: '/assets/images/publish/publish-cover-food.webp'
});

Component({
  properties: {
    item: { type: Object, value: null },
    variant: { type: String, value: 'compact' }
  },
  data: { coverSrc: '', coverFailed: false, largeText: false, avatarSlots: [] },
  observers: {
    'item, variant'(item, variant) {
      const tone = item && item.typeTone;
      const coverSrc = variant === 'discover' && Object.prototype.hasOwnProperty.call(COVERS, tone) ? COVERS[tone] : '';
      const avatarSlots = item && Array.isArray(item.visibleAvatarSlots)
        ? item.visibleAvatarSlots.map((slot) => {
            const copy = { ...slot };
            return this._failedAvatarSources && this._failedAvatarSources.has(copy.src)
              ? fallbackAvatarSlot(copy)
              : copy;
          })
        : [];
      this.setData({ avatarSlots, ...(coverSrc !== this.data.coverSrc ? { coverSrc, coverFailed: false } : {}) });
    }
  },
  lifetimes: {
    attached() { this.refreshTextSize(); }
  },
  pageLifetimes: {
    show() { this.refreshTextSize(); }
  },
  methods: {
    refreshTextSize() {
      if (this.data.variant !== 'discover') return;
      try {
        const info = typeof wx === 'undefined' ? null
          : typeof wx.getAppBaseInfo === 'function' ? wx.getAppBaseInfo()
            : typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : null;
        const size = Number(info && info.fontSizeSetting);
        this.setData({ largeText: !Number.isFinite(size) || size <= 0 || size > 16 });
      } catch (error) {
        // If sizing is unavailable, prefer readable flowing text to truncation.
        this.setData({ largeText: true });
      }
    },
    handleCoverError(event) {
      const src = event && event.currentTarget && event.currentTarget.dataset.src;
      if (src && src === this.data.coverSrc) this.setData({ coverFailed: true });
    },
    handleAvatarError(event) {
      const dataset = event && event.currentTarget && event.currentTarget.dataset || {};
      const index = Number(dataset.index);
      if (!Number.isInteger(index) || index < 0 || index >= this.data.avatarSlots.length) return;
      const current = this.data.avatarSlots[index];
      if (!current || current.id !== dataset.slotId || current.src !== dataset.src) return;
      const next = fallbackAvatarSlot(current);
      if (!next || next === current) return;
      if (!this._failedAvatarSources) this._failedAvatarSources = new Set();
      this._failedAvatarSources.add(current.src);
      this.setData({ [`avatarSlots[${index}]`]: next });
    },
    handleTap() {
      if (this.data.item) this.triggerEvent('select', { id: this.data.item.id });
    }
  }
});
