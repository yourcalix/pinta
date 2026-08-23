'use strict';

Component({
  properties: {
    item: { type: Object, value: null }
  },
  methods: {
    handleTap() {
      if (this.data.item) this.triggerEvent('select', { id: this.data.item.id });
    }
  }
});
