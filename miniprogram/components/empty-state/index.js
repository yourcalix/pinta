'use strict';

Component({
  properties: {
    title: { type: String, value: '暂无内容' },
    description: { type: String, value: '' },
    actionText: { type: String, value: '' },
    symbol: { type: String, value: '○' }
  },
  methods: {
    handleAction() {
      this.triggerEvent('action');
    }
  }
});
