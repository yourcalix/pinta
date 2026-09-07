'use strict';

const { fallbackAvatarSlot, normalizeAvatarSlots } = require('../../utils/passenger-avatar');

const COVERS = Object.freeze({
  companion: '/assets/images/publish/publish-cover-companion.png',
  sport: '/assets/images/publish/publish-cover-sport.png',
  food: '/assets/images/publish/publish-cover-food.png'
});

Component({
  properties: {
    item: { type: Object, value: null },
    variant: { type: String, value: 'compact' },
    largeText: { type: Boolean, value: false }
  },
  data: { coverSrc: '', coverFailed: false, avatarSlots: [], ownerAvatar: null },
  observers: {
    'item, variant'(item, variant) {
      const tone = item && item.typeTone;
      const coverSrc = variant === 'home-preview' && Object.prototype.hasOwnProperty.call(COVERS, tone) ? COVERS[tone] : '';
      const avatarSlots = item && Array.isArray(item.visibleAvatarSlots)
        ? item.visibleAvatarSlots.map((slot) => {
            const copy = { ...slot };
            return this._failedAvatarSources && this._failedAvatarSources.has(copy.src)
              ? fallbackAvatarSlot(copy)
              : copy;
          })
        : [];
      const rawOwnerAvatar = item && item.ownerProfile && item.ownerProfile.avatar;
      let ownerAvatar = normalizeAvatarSlots(rawOwnerAvatar ? [rawOwnerAvatar] : [], 1)[0];
      if (ownerAvatar) ownerAvatar = { ...ownerAvatar, id: 'owner-avatar' };
      if (ownerAvatar && this._failedAvatarSources && this._failedAvatarSources.has(ownerAvatar.src)) {
        ownerAvatar = fallbackAvatarSlot(ownerAvatar);
      }
      this.setData({ avatarSlots, ownerAvatar, ...(coverSrc !== this.data.coverSrc ? { coverSrc, coverFailed: false } : {}) });
    }
  },
  methods: {
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
    handleOwnerAvatarError(event) {
      const dataset = event && event.currentTarget && event.currentTarget.dataset || {};
      const current = this.data.ownerAvatar;
      if (!current || current.id !== dataset.slotId || current.src !== dataset.src) return;
      const next = fallbackAvatarSlot(current);
      if (!next || next === current) return;
      if (!this._failedAvatarSources) this._failedAvatarSources = new Set();
      this._failedAvatarSources.add(current.src);
      this.setData({ ownerAvatar: next });
    },
    handleTap() {
      if (this.data.item) this.triggerEvent('select', { id: this.data.item.id });
    }
  }
});
