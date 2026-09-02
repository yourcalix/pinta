'use strict';

const directMessageService = require('../services/direct-message');

function selectTab(page, selected) {
  if (!page || typeof page.getTabBar !== 'function') return;
  const tabBar = page.getTabBar();
  if (tabBar && typeof tabBar.setData === 'function') tabBar.setData({ selected });
}

async function refreshUnread(page) {
  if (!page || typeof page.getTabBar !== 'function') return 0;
  const tabBar = page.getTabBar();
  if (!tabBar || typeof tabBar.setUnread !== 'function') return 0;
  try {
    const result = await directMessageService.unread();
    const total = Math.max(0, Number(result && result.totalUnread) || 0);
    tabBar.setUnread(total);
    return total;
  } catch (error) {
    // Keep the last confirmed badge when refresh fails. A network error is not
    // evidence that unread messages disappeared.
    return Math.max(0, Number(tabBar.data && tabBar.data.unread) || 0);
  }
}

module.exports = { selectTab, refreshUnread };
