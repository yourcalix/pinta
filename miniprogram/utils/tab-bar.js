'use strict';

const directMessageService = require('../services/direct-message');
const api = require('../services/api');

let confirmedScope = '';
let confirmedUnread = 0;
let requestSequence = 0;

function actorScope() {
  try {
    const user = typeof getApp === 'function' && getApp().globalData.user;
    return user && user.status === 'ACTIVE' && user.profileComplete ? api.getActorScope() : '';
  } catch (error) { return ''; }
}

function resolveTabBar(page) {
  try {
    if (!page && typeof getCurrentPages === 'function') {
      const pages = getCurrentPages();
      page = pages[pages.length - 1];
    }
    return page && typeof page.getTabBar === 'function' ? page.getTabBar() : null;
  } catch (error) { return null; }
}

function syncScope() {
  const scope = actorScope();
  if (scope !== confirmedScope) {
    confirmedScope = scope;
    confirmedUnread = 0;
    requestSequence += 1;
  }
  return scope;
}

function selectTab(page, selected) {
  const scope = syncScope();
  const tabBar = resolveTabBar(page);
  if (tabBar && typeof tabBar.setData === 'function') tabBar.setData({ selected });
  if (tabBar && typeof tabBar.setUnread === 'function') tabBar.setUnread(confirmedUnread);
  if (scope) refreshUnread(page);
}

async function refreshUnread(page) {
  const scope = syncScope();
  const sequence = ++requestSequence;
  const tabBar = resolveTabBar(page);
  if (!scope) {
    if (tabBar && typeof tabBar.setUnread === 'function') tabBar.setUnread(0);
    return 0;
  }
  try {
    const result = await directMessageService.unread();
    if (sequence !== requestSequence || actorScope() !== scope) return confirmedUnread;
    const total = result && result.totalUnread;
    if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid unread summary');
    confirmedUnread = total;
    if (tabBar && typeof tabBar.setUnread === 'function') tabBar.setUnread(total);
    return total;
  } catch (error) {
    // Keep the last confirmed badge when refresh fails. A network error is not
    // evidence that unread messages disappeared.
    return confirmedUnread;
  }
}

module.exports = { selectTab, refreshUnread };
