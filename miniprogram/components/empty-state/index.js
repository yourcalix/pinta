'use strict';

const IMAGE_MAP = Object.freeze({
  'empty-activity': '/assets/images/empty/activity.png',
  'empty-joined': '/assets/images/empty/joined.png',
  'empty-message': '/assets/images/empty/message.png',
  'empty-search': '/assets/images/empty/search.png',
  'empty-favorite': '/assets/images/empty/favorite.png',
  'empty-network': '/assets/images/empty/network.png'
});
const VALID_SIZES = new Set(['compact', 'small', 'default', 'large']);

Component({
  externalClasses: ['custom-class'],
  options: { multipleSlots: true },

  properties: {
    type: { type: String, value: 'empty-activity' },
    title: { type: String, value: '暂无内容' },
    description: { type: String, value: '' },
    buttonText: { type: String, value: '' },
    actionText: { type: String, value: '' },
    showButton: { type: Boolean, value: true },
    loading: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    customImage: { type: String, value: '' },
    size: { type: String, value: 'default' },
    animation: { type: Boolean, value: true },
    lazyLoad: { type: Boolean, value: true },
    imageAriaLabel: { type: String, value: '' },
    symbol: { type: String, value: '' }
  },

  data: {
    imageSrc: IMAGE_MAP['empty-activity'],
    resolvedSize: 'default',
    resolvedButtonText: ''
  },

  observers: {
    'type, customImage': function observeImage(type, customImage) {
      this.syncImage(type, customImage);
    },
    size: function observeSize(size) {
      const resolvedSize = VALID_SIZES.has(size) ? size : 'default';
      if (resolvedSize !== this.data.resolvedSize) this.setData({ resolvedSize });
    },
    'buttonText, actionText': function observeButtonText(buttonText, actionText) {
      const resolvedButtonText = String(buttonText || actionText || '');
      if (resolvedButtonText !== this.data.resolvedButtonText) this.setData({ resolvedButtonText });
    }
  },

  lifetimes: {
    attached() {
      this.syncImage(this.data.type, this.data.customImage);
    }
  },

  methods: {
    syncImage(type, customImage) {
      const imageSrc = String(customImage || '') || IMAGE_MAP[type] || IMAGE_MAP['empty-activity'];
      if (imageSrc !== this.data.imageSrc) this.setData({ imageSrc });
    },

    handleAction() {
      if (this.data.disabled || this.data.loading) return;
      this.triggerEvent('action', { type: this.data.type });
    }
  }
});

module.exports = { IMAGE_MAP, VALID_SIZES };
