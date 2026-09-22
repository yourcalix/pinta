'use strict';

const VARIANT_PRESENTATIONS = Object.freeze({
  WORLD: { src: './assets/world.jpg', label: '一起去看看更大的世界，欢迎加入乐聚拼吧' },
  FOOD: { src: './assets/food.jpg', label: '一顿饭遇见好朋友，欢迎加入乐聚拼吧' },
  ADVENTURE: { src: './assets/adventure.jpg', label: '开启森林冒险，欢迎加入乐聚拼吧' },
  SPORT: { src: './assets/sport.jpg', label: '先从一场运动开始，欢迎加入乐聚拼吧' },
  HOST: { src: './assets/host.jpg', label: '发起你的第一场活动，欢迎加入乐聚拼吧' },
  ELVES: { src: './assets/elves.jpg', label: '欢迎加入精灵小队，开启你的拼吧旅程' }
});

function presentationFor(variant) {
  return VARIANT_PRESENTATIONS[variant] || VARIANT_PRESENTATIONS.WORLD;
}

Component({
  options: {
    styleIsolation: 'isolated'
  },

  properties: {
    variant: {
      type: String,
      value: 'WORLD',
      observer(value) {
        this._assetReported = false;
        this._assetFailed = false;
        this.setData({
          presentation: presentationFor(value),
          assetReady: false
        });
      }
    },
    open: {
      type: Boolean,
      value: false,
      observer(value) {
        this.clearCloseTimer();
        if (value) {
          this._wasOpened = true;
          this._dismissed = false;
          return;
        }
        if (!this._wasOpened) return;
        this._closeTimer = setTimeout(() => {
          this._closeTimer = null;
          if (!this.properties.open) this.triggerEvent('closed');
        }, 220);
      }
    }
  },

  data: {
    presentation: presentationFor('WORLD'),
    assetReady: false
  },

  lifetimes: {
    attached() {
      this._assetReported = false;
      this._assetFailed = false;
      this._dismissed = false;
      this._wasOpened = false;
      this._closeTimer = null;
    },
    detached() {
      this.clearCloseTimer();
    }
  },

  methods: {
    clearCloseTimer() {
      if (this._closeTimer !== null) clearTimeout(this._closeTimer);
      this._closeTimer = null;
    },

    handleAssetLoad() {
      if (this._assetReported || this._assetFailed) return;
      this._assetReported = true;
      this.setData({ assetReady: true }, () => this.triggerEvent('assetready'));
    },

    handleAssetError() {
      if (this._assetFailed) return;
      this._assetFailed = true;
      this.triggerEvent('asseterror');
    },

    handleDismiss() {
      if (!this.properties.open || this._dismissed) return;
      this._dismissed = true;
      this.triggerEvent('dismiss');
    },

    preventTouchMove() {}
  }
});
