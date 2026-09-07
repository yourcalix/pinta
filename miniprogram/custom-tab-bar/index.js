'use strict';

Component({
  data: {
    selected: 0,
    hidden: false,
    unread: 0,
    unreadLabel: '',
    items: [
      { pagePath: '/pages/discover/index', text: '首页', kind: 'home', iconSrc: '/custom-tab-bar/assets/concept-a/tab-home.png' },
      { pagePath: '/pages/community/index', text: '发现', kind: 'discover', iconSrc: '/custom-tab-bar/assets/concept-a/tab-discover.png' },
      { pagePath: '/pages/publish/index', text: '发布', publish: true, iconSrc: '/custom-tab-bar/assets/concept-a/tab-publish-plus.png' },
      { pagePath: '/pages/messages/index', text: '消息', message: true, iconSrc: '/custom-tab-bar/assets/concept-a/tab-message.png' },
      { pagePath: '/pages/user/index', text: '我的', kind: 'user', iconSrc: '/custom-tab-bar/assets/concept-a/tab-user.png' }
    ]
  },

  methods: {
    setHidden(hidden) {
      this.setData({ hidden: Boolean(hidden) });
    },

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
