'use strict';

Component({
  data: {
    selected: 0,
    unread: 0,
    unreadLabel: '',
    items: [
      { pagePath: '/pages/discover/index', text: '发现', icon: '/custom-tab-bar/assets/tab-discover-painted.png' },
      { pagePath: '/pages/community/index', text: '社区', icon: '/custom-tab-bar/assets/tab-community-painted.png' },
      { pagePath: '/pages/publish/index', text: '发布', publish: true },
      { pagePath: '/pages/messages/index', text: '消息', message: true },
      { pagePath: '/pages/user/index', text: '我的', icon: '/custom-tab-bar/assets/tab-user-painted.png' }
    ]
  },

  methods: {
    switchTab(event) {
      const path = event.currentTarget.dataset.path;
      if (!path) return;
      wx.switchTab({ url: path });
    },

    setUnread(value) {
      const unread = Math.max(0, Number(value) || 0);
      this.setData({ unread, unreadLabel: unread > 99 ? '99+' : String(unread || '') });
    }
  }
});
