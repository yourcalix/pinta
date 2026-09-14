'use strict';

const communityService = require('../services/community');
const userService = require('../services/user');
const ephemeralProfileNavigation = require('../services/ephemeral-profile-navigation');

async function openCommunityAuthor(page, sourceType, sourceId) {
  if (!page || page._authorNavPending || !['post', 'reply'].includes(sourceType) || !sourceId) return;
  page._authorNavPending = true;
  let key = '';
  let handedOff = false;
  try {
    await userService.login();
    const result = await communityService.createProfileNavigation(sourceType, sourceId);
    if (page._disposed) return;
    if (result.target === 'self') {
      handedOff = true;
      return void wx.switchTab({ url: '/pages/user/index', fail: () => { page._authorNavPending = false; } });
    }
    if (result.target !== 'public' || !result.profileNavToken) throw new Error('主页凭据无效');
    key = ephemeralProfileNavigation.issue({ profileNavToken: result.profileNavToken, profileNavExpiresAt: result.expiresAt, source: 'community' });
    handedOff = true;
    wx.navigateTo({
      url: `/subpackages/profile/public/index?k=${encodeURIComponent(key)}`,
      fail: () => {
        ephemeralProfileNavigation.revoke(key);
        page._authorNavPending = false;
        wx.showToast({ title: '暂时无法打开主页', icon: 'none' });
      }
    });
  } catch (error) {
    if (!page._disposed && !error.handled) wx.showToast({ title: error.code === 'NOT_FOUND' ? '该用户暂时无法查看' : error.message || '暂时无法打开主页', icon: 'none' });
  } finally {
    if (!handedOff) page._authorNavPending = false;
  }
}

module.exports = { openCommunityAuthor };
