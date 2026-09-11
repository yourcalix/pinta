<GEMINI_WEB_PROMPT>
ROLE: frontend implementation reviewer

审查拼吧微信原生小程序首页“按时间动态问候”的实际实现。

目标：原“你好，昵称”根据澳门UTC+8显示：
00:00–04:59 夜深了
05:00–08:59 早上好
09:00–11:59 上午好
12:00–13:59 中午好
14:00–17:59 下午好
18:00–23:59 晚上好

实现边界：
- 新增纯函数 resolveMacauGreeting(now)，使用UTC小时+8，不依赖设备时区。
- 首页data新增greetingSalutation，在onLoad与每次onShow同步。
- 不增加常驻计时器，避免干扰既有启动动画定时器；用户离开再回首页时刷新。
- WXML可见标题和ARIA都消费同一问候字段。
- 昵称、头像、首页布局、网络请求和后端均未改。
- 现有greeting-title具备单行ellipsis，长昵称仍有保护。
- 373测试通过、0失败、1跳过；项目结构检查和JS语法检查通过。
- 尚未真机验收，不要声称真机已经验证。

重点检查：澳门时间边界是否正确；onLoad/onShow生命周期是否可靠；无障碍文案是否同步；是否引入定时器、时区或布局风险；测试是否覆盖关键边界。
只聚焦本次差异，历史问题单列。输出Critical/Warning/Info，每项给出文件和最小修正，最后APPROVE或REVISE。不要输出无关重构。

FILE: miniprogram/utils/home-greeting.js
```
'use strict';

const MACAU_UTC_OFFSET_HOURS = 8;
function macauHour(now = new Date()) {
  const value = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(value.getTime())) return 9;
  return (value.getUTCHours() + MACAU_UTC_OFFSET_HOURS) % 24;
}

function resolveMacauGreeting(now = new Date()) {
  const hour = macauHour(now);
  if (hour < 5) return '夜深了';
  if (hour < 9) return '早上好';
  if (hour < 12) return '上午好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

module.exports = {
  resolveMacauGreeting
};
```

FILE: miniprogram/pages/discover/index.js
```
'use strict';

const activityService = require('../../services/activity');
const safetyService = require('../../services/safety');
const { decorateActivity } = require('../../utils/display');
const { calculateContentTopInset } = require('../../utils/navigation-layout');
const {
  expirationSchedule,
  removeLocallyExpiredRecruiting
} = require('../../utils/discover-list');
const { resolveProfileAvatar } = require('../../utils/profile-avatar');
const { resolveMacauGreeting } = require('../../utils/home-greeting');
const {
  TOTAL_BLOCKS,
  PRELOAD_BLOCKS,
  STEP_INTERVAL_MS,
  FINISH_GATE_MS,
  FINISH_INTERVAL_MS,
  DROP_DURATION_MS,
  HOLD_MS,
  FADE_MS,
  MAX_SPLASH_WAIT_MS
} = require('../../utils/launch-progress');
const { selectTab } = require('../../utils/tab-bar');

const PAGE_SIZE = 3;
const MAX_HIDDEN_PAGE_SKIPS = 1;
const LARGE_TEXT_FONT_SIZE = 20;
const DEFAULT_GREETING_AVATAR = '/assets/images/profile/profile-avatar-neutral-painted.png';

function hasActiveFilters(filters) {
  return Boolean(filters.type || filters.appliedKeyword);
}

Page({
  data: {
    greetingSalutation: '你好',
    greetingNickname: '搭子',
    greetingAvatarPath: DEFAULT_GREETING_AVATAR,
    greetingAvatarFallbackPath: DEFAULT_GREETING_AVATAR,
    searchPanelVisible: false,
    shortcutIconPaths: {
      activities: '/assets/images/home/shortcut-group.png',
      memories: '/assets/images/home/shortcut-memory.png',
      placeholder: '/assets/images/home/shortcut-placeholder.png'
    },
    typeOptions: [
      { value: '', label: '全部', iconSrc: '/assets/images/discover/filter-all.png' },
      { value: 'companion', label: '拼同行', iconSrc: '/assets/images/discover/filter-companion.png' },
      { value: 'sport', label: '拼运动', iconSrc: '/assets/images/discover/filter-sport.png' },
      { value: 'food', label: '拼饭桌', iconSrc: '/assets/images/discover/filter-food.png' }
    ],
    type: '',
    keyword: '',
    appliedKeyword: '',
    hasActiveFilters: false,
    activities: [],
    loading: true,
    refreshing: false,
    error: '',
    contentTopInset: 88,
    largeTextMode: false,
    launchSplashVisible: false,
    launchSplashExiting: false,
    launchProgress: 0
  },

  onLoad() {
    this.setData({
      contentTopInset: calculateContentTopInset(typeof wx === 'undefined' ? null : wx)
    });
    this.syncTextSizeMode();
    this.syncGreetingSalutation();
    this.syncGreetingProfile();
    this._skipFirstShow = true;
    this.startLaunchSplash();
    const activities = Promise.resolve(this.fetchActivities({ mode: 'replace' }))
      .finally(() => this.markLaunchSplashReady());
    return activities;
  },

  onShow() {
    this._allActivitiesNavigationPending = false;
    this._nearbyNavigationPending = false;
    this.releaseMemoriesNavigationLock();
    selectTab(this, 0);
    this.syncTextSizeMode();
    this.syncGreetingSalutation();
    this.syncGreetingProfile();
    if (this._skipFirstShow) {
      this._skipFirstShow = false;
      return;
    }
    return this.fetchActivities({ mode: 'replace', keepContent: true });
  },

  onHide() {
    this._loadSeq = (this._loadSeq || 0) + 1;
    this._allActivitiesNavigationPending = false;
    this._nearbyNavigationPending = false;
    this.releaseMemoriesNavigationLock();
    this.clearExpirationTimer();
    this.teardownLaunchSplash(true);
  },

  onUnload() {
    this._loadSeq = (this._loadSeq || 0) + 1;
    this._allActivitiesNavigationPending = false;
    this._nearbyNavigationPending = false;
    this.releaseMemoriesNavigationLock();
    this.clearExpirationTimer();
    this.teardownLaunchSplash(false);
  },

  async onPullDownRefresh() {
    try {
      await this.fetchActivities({ mode: 'replace', keepContent: true, notifyFailure: true });
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async fetchActivities(options = {}) {
    const keepContent = options.keepContent === true;
    const allowAutoFill = options.allowAutoFill !== false;
    const loadSeq = (this._loadSeq = (this._loadSeq || 0) + 1);
    this.clearExpirationTimer();
    const resetContent = !keepContent;
    this.setData({
      loading: resetContent || this.data.activities.length === 0,
      refreshing: true,
      error: '',
      ...(resetContent ? {
        activities: []
      } : {})
    });

    try {
      const snapshot = await this.requestActivityPage(undefined, allowAutoFill);
      if (loadSeq !== this._loadSeq) return false;

      const activities = snapshot.activities;
      this.setData({
        activities,
        loading: false,
        refreshing: false,
        error: ''
      });
      this.scheduleExpirationRefresh(activities);
      return true;
    } catch (error) {
      if (loadSeq !== this._loadSeq) return false;
      const hasContent = keepContent && this.data.activities.length > 0;
      this.setData({
        loading: false,
        refreshing: false,
        error: hasContent ? '' : '活动列表加载失败，请重试'
      });
      this.scheduleExpirationRefresh(this.data.activities);
      if (hasContent && options.notifyFailure && typeof wx.showToast === 'function') {
        wx.showToast({ title: '刷新失败，请稍后重试', icon: 'none' });
      }
      return false;
    }
  },

  async requestActivityPage(cursor, allowAutoFill) {
    let requestCursor = cursor || undefined;
    let skips = 0;
    while (true) {
      const result = await activityService.list({
        type: this.data.type || undefined,
        keyword: this.data.appliedKeyword || undefined,
        limit: PAGE_SIZE,
        cursor: requestCursor
      });
      const activities = safetyService
        .filterHiddenActivities(result.items || [])
        .slice(0, PAGE_SIZE)
        .map(decorateActivity);
      const nextCursor = result.nextCursor ? String(result.nextCursor) : '';
      if (activities.length || !nextCursor || !allowAutoFill || skips >= MAX_HIDDEN_PAGE_SKIPS) {
        return { activities, nextCursor };
      }
      requestCursor = nextCursor;
      skips += 1;
    }
  },

  scrollToHotPinba() {
    if (typeof wx === 'undefined' || typeof wx.pageScrollTo !== 'function') return;
    wx.pageScrollTo({ selector: '#hot-pinba-heading', duration: 200 });
  },

  scheduleExpirationRefresh(items) {
    this.clearExpirationTimer();
    const schedule = expirationSchedule(items);
    if (!schedule) return;
    this._nextExpirationAt = schedule.deadlineAt;
    this._expirationTimer = setTimeout(() => {
      this._expirationTimer = null;
      if (Date.now() < this._nextExpirationAt) {
        this.scheduleExpirationRefresh(this.data.activities);
        return;
      }
      const activities = removeLocallyExpiredRecruiting(this.data.activities);
      if (activities.length !== this.data.activities.length) this.setData({ activities });
      this.fetchActivities({ mode: 'replace', keepContent: true });
    }, schedule.delay);
  },

  clearExpirationTimer() {
    if (this._expirationTimer) clearTimeout(this._expirationTimer);
    this._expirationTimer = null;
  },

  startLaunchSplash() {
    const app = typeof getApp === 'function' ? getApp() : null;
    const globalData = app && app.globalData;
    if (!globalData || globalData.launchSplashShown) return false;

    globalData.launchSplashShown = true;
    this._launchSplashActive = true;
    this._launchSplashReady = false;
    this._launchSplashMinimumReached = false;
    this._launchSplashCompleting = false;
    this._launchTimers = new Set();
    this.setData({
      launchSplashVisible: true,
      launchSplashExiting: false,
      launchProgress: 0
    });
    this.hideLaunchTabBar();

    for (let progress = 1; progress <= PRELOAD_BLOCKS; progress += 1) {
      this.queueLaunchTimer(() => {
        if (!this._launchSplashActive) return;
        this.setData({ launchProgress: progress });
      }, (progress - 1) * STEP_INTERVAL_MS);
    }
    this.queueLaunchTimer(() => {
      if (!this._launchSplashActive) return;
      this._launchSplashMinimumReached = true;
      this.completeLaunchSplashWhenReady();
    }, FINISH_GATE_MS);
    this.queueLaunchTimer(() => {
      if (!this._launchSplashActive || this._launchSplashReady) return;
      this.teardownLaunchSplash(true);
    }, MAX_SPLASH_WAIT_MS);
    return true;
  },

  markLaunchSplashReady() {
    if (!this._launchSplashActive) return;
    this._launchSplashReady = true;
    this.completeLaunchSplashWhenReady();
  },

  completeLaunchSplashWhenReady() {
    if (
      !this._launchSplashActive
      || !this._launchSplashReady
      || !this._launchSplashMinimumReached
      || this._launchSplashCompleting
    ) return;

    this._launchSplashCompleting = true;
    for (let progress = PRELOAD_BLOCKS + 1; progress <= TOTAL_BLOCKS; progress += 1) {
      this.queueLaunchTimer(() => {
        if (this._launchSplashActive) this.setData({ launchProgress: progress });
      }, (progress - PRELOAD_BLOCKS - 1) * FINISH_INTERVAL_MS);
    }
    const fullAt = (TOTAL_BLOCKS - PRELOAD_BLOCKS - 1) * FINISH_INTERVAL_MS + DROP_DURATION_MS;
    this.queueLaunchTimer(() => {
      if (this._launchSplashActive) this.setData({ launchSplashExiting: true });
    }, fullAt + HOLD_MS);
    this.queueLaunchTimer(() => this.finishLaunchSplash(), fullAt + HOLD_MS + FADE_MS);
  },

  queueLaunchTimer(callback, delay) {
    if (!this._launchTimers) this._launchTimers = new Set();
    const timer = setTimeout(() => {
      this._launchTimers.delete(timer);
      callback();
    }, delay);
    this._launchTimers.add(timer);
    return timer;
  },

  clearLaunchTimers() {
    if (!this._launchTimers) return;
    this._launchTimers.forEach((timer) => clearTimeout(timer));
    this._launchTimers.clear();
  },

  handleLaunchAssetError() {
    this.teardownLaunchSplash(true);
  },

  setCustomTabBarHidden(hidden) {
    if (typeof this.getTabBar !== 'function') return false;
    try {
      const tabBar = this.getTabBar();
      if (!tabBar || typeof tabBar.setHidden !== 'function') return false;
      tabBar.setHidden(hidden);
      return true;
    } catch (error) {
      return false;
    }
  },

  hideLaunchTabBar() {
    this.setCustomTabBarHidden(true);
  },

  restoreLaunchTabBar() {
    this.setCustomTabBarHidden(false);
  },

  finishLaunchSplash() {
    if (!this._launchSplashActive) return;
    this._launchSplashActive = false;
    this.clearLaunchTimers();
    this.setData({
      launchSplashVisible: false,
      launchSplashExiting: false
    });
    this.restoreLaunchTabBar();
  },

  teardownLaunchSplash(updateView) {
    const wasActive = this._launchSplashActive === true;
    this._launchSplashActive = false;
    this.clearLaunchTimers();
    if (wasActive && updateView) {
      this.setData({
        launchSplashVisible: false,
        launchSplashExiting: false
      });
    }
    this.restoreLaunchTabBar();
  },

  handleTypeChange(event) {
    const type = event.currentTarget.dataset.value || '';
    if (type === this.data.type) return false;
    this.setData({
      type,
      hasActiveFilters: hasActiveFilters({ ...this.data, type })
    });
    return this.fetchActivities({ mode: 'replace' });
  },

  syncGreetingSalutation() {
    const greetingSalutation = resolveMacauGreeting();
    if (greetingSalutation !== this.data.greetingSalutation) {
      this.setData({ greetingSalutation });
    }
  },

  syncGreetingProfile() {
    const app = typeof getApp === 'function' ? getApp() : null;
    const profile = app && app.globalData && app.globalData.user && app.globalData.user.profile;
    const nickname = String(profile && profile.nickname || '搭子').trim() || '搭子';
    const avatar = resolveProfileAvatar(profile);
    const next = {
      greetingNickname: nickname,
      greetingAvatarPath: avatar.path || DEFAULT_GREETING_AVATAR,
      greetingAvatarFallbackPath: avatar.fallbackPath || DEFAULT_GREETING_AVATAR
    };
    if (
      next.greetingNickname !== this.data.greetingNickname
      || next.greetingAvatarPath !== this.data.greetingAvatarPath
      || next.greetingAvatarFallbackPath !== this.data.greetingAvatarFallbackPath
    ) this.setData(next);
  },

  handleGreetingAvatarError() {
    if (this.data.greetingAvatarPath === this.data.greetingAvatarFallbackPath) return;
    this.setData({ greetingAvatarPath: this.data.greetingAvatarFallbackPath });
  },

  syncTextSizeMode() {
    let info = null;
    try {
      if (typeof wx !== 'undefined' && typeof wx.getAppBaseInfo === 'function') info = wx.getAppBaseInfo();
      else if (typeof wx !== 'undefined' && typeof wx.getSystemInfoSync === 'function') info = wx.getSystemInfoSync();
    } catch (error) {
      info = null;
    }
    const fontSizeSetting = Number(info && info.fontSizeSetting);
    const largeTextMode = Number.isFinite(fontSizeSetting) && fontSizeSetting >= LARGE_TEXT_FONT_SIZE;
    if (largeTextMode !== this.data.largeTextMode) this.setData({ largeTextMode });
    return largeTextMode;
  },

  handleHeaderAction(event) {
    const action = event.currentTarget.dataset.action;
    if (action === 'messages') {
      wx.switchTab({ url: '/pages/messages/index' });
      return true;
    }
    if (action === 'search') {
      this.setData({ searchPanelVisible: !this.data.searchPanelVisible });
      return true;
    }
    return false;
  },

  handleCloseSearch() {
    if (!this.data.searchPanelVisible) return false;
    this.setData({ searchPanelVisible: false });
    return true;
  },

  handleHomeShortcut(event) {
    const action = event.currentTarget.dataset.action;
    if (action === 'activities') {
      if (this._allActivitiesNavigationPending) return false;
      this._allActivitiesNavigationPending = true;
      wx.navigateTo({
        url: '/subpackages/activity/list/index',
        fail: () => { this._allActivitiesNavigationPending = false; }
      });
      return true;
    }
    if (action === 'memories') {
      if (this._memoriesNavigationPending) return false;
      this._memoriesNavigationPending = true;
      this._memoriesNavigationTimer = setTimeout(() => {
        this._memoriesNavigationTimer = null;
        this._memoriesNavigationPending = false;
      }, 500);
      wx.navigateTo({
        url: '/subpackages/activity/memories/index',
        fail: () => {
          this.releaseMemoriesNavigationLock();
          if (typeof wx.showToast === 'function') {
            wx.showToast({ title: '页面打开失败，请稍后重试', icon: 'none' });
          }
        }
      });
      return true;
    }
    return false;
  },

  releaseMemoriesNavigationLock() {
    if (this._memoriesNavigationTimer) clearTimeout(this._memoriesNavigationTimer);
    this._memoriesNavigationTimer = null;
    this._memoriesNavigationPending = false;
  },

  handleNavigateToAll() {
    if (this._nearbyNavigationPending) return false;
    this._nearbyNavigationPending = true;
    wx.navigateTo({
      url: '/subpackages/activity/nearby/index',
      fail: () => { this._nearbyNavigationPending = false; }
    });
    return true;
  },

  handleKeywordInput(event) {
    this.setData({ keyword: event.detail.value });
  },

  handleSearch() {
    const appliedKeyword = this.data.keyword.trim();
    this.setData({
      appliedKeyword,
      hasActiveFilters: hasActiveFilters({ ...this.data, appliedKeyword })
    });
    return this.fetchActivities({ mode: 'replace' });
  },

  handleClearKeyword() {
    const shouldReload = Boolean(this.data.appliedKeyword);
    this.setData({
      keyword: '',
      appliedKeyword: '',
      hasActiveFilters: Boolean(this.data.type)
    });
    return shouldReload ? this.fetchActivities({ mode: 'replace' }) : false;
  },

  handleClearFilters() {
    this.setData({
      type: '',
      keyword: '',
      appliedKeyword: '',
      hasActiveFilters: false
    });
    return this.fetchActivities({ mode: 'replace' });
  },

  handleCardSelect(event) {
    wx.navigateTo({
      url: `/subpackages/activity/detail/index?id=${encodeURIComponent(event.detail.id)}`
    });
  },

  handleEmptyAction() {
    if (this.data.error) return this.fetchActivities({ mode: 'replace' });
    if (this.data.hasActiveFilters) return this.handleClearFilters();
    wx.switchTab({ url: '/pages/publish/index' });
  }
});
```

FILE: miniprogram/pages/discover/index.wxml
```
<view class="page home-page" style="padding-top: {{contentTopInset}}px;">
  <launch-splash wx:if="{{launchSplashVisible}}" progress="{{launchProgress}}" exiting="{{launchSplashExiting}}" bindasseterror="handleLaunchAssetError" />

  <view class="home-content">
    <view class="home-greeting" role="heading" aria-level="1" aria-label="{{greetingSalutation}}，{{greetingNickname}}，欢迎你回到拼吧">
      <image class="greeting-avatar" src="{{greetingAvatarPath}}" mode="aspectFill" binderror="handleGreetingAvatarError" aria-hidden="true" />
      <view class="greeting-copy">
        <text class="greeting-title">{{greetingSalutation}}，{{greetingNickname}} <text aria-hidden="true">👋</text></text>
        <text class="greeting-subtitle">欢迎你回到拼吧</text>
      </view>
    </view>

    <view class="home-hero" role="region" aria-label="你的搭子，刚刚好。发现身边同频的人和活动">
      <view class="hero-copy">
        <view class="hero-title"><text>你的搭子，</text><text class="hero-title-accent">刚刚好</text></view>
        <text class="hero-subtitle">发现身边同频的人和活动</text>
      </view>
      <view class="hero-actions" aria-label="首页消息与搜索">
        <button class="header-action header-action--message" data-action="messages" bindtap="handleHeaderAction" hover-class="control--pressed" aria-label="查看消息"><image class="header-action-icon" src="/assets/icons/home/header-bell.png" mode="aspectFit" aria-hidden="true" /></button>
        <button class="header-action header-action--search {{hasActiveFilters ? 'header-action--search-active' : ''}}" data-action="search" bindtap="handleHeaderAction" hover-class="control--pressed" aria-label="{{searchPanelVisible ? '收起活动搜索' : '搜索活动'}}"><image class="header-action-icon" src="/assets/icons/home/header-search.png" mode="aspectFit" aria-hidden="true" /></button>
      </view>
      <view wx:if="{{searchPanelVisible}}" class="hero-search-backdrop" catchtap="handleCloseSearch" aria-hidden="true"></view>
      <view wx:if="{{searchPanelVisible}}" class="hero-search-floating-bar {{searchPanelVisible ? 'hero-search-floating-bar--visible' : ''}}" role="search" aria-label="首页活动搜索框">
        <image class="hero-search-icon" src="/assets/icons/home/header-search.png" mode="aspectFit" aria-hidden="true" />
        <input class="hero-search-input" value="{{keyword}}" focus="{{searchPanelVisible}}" adjust-position="{{false}}" cursor-spacing="12" placeholder="搜索活动/发起人" placeholder-class="hero-search-placeholder" confirm-type="search" aria-label="输入活动名称、地点或发起人关键词" bindinput="handleKeywordInput" bindconfirm="handleSearch" />
        <button wx:if="{{keyword}}" class="hero-search-clear" bindtap="handleClearKeyword" hover-class="control--pressed" aria-label="清空搜索内容">×</button>
      </view>
      <view class="hero-illustration-slot" aria-hidden="true"><image class="hero-illustration-image" src="/assets/images/home/hero-community-puzzle.png" mode="aspectFit" /></view>
    </view>

    <view class="home-shortcuts" aria-label="首页快捷入口">
      <button class="home-shortcut home-shortcut--activities" data-action="activities" bindtap="handleHomeShortcut" hover-class="home-shortcut--pressed" aria-label="组队拼团，看看大家都在聊什么">
        <text class="shortcut-title">组队拼团</text><text class="shortcut-subtitle shortcut-subtitle--activities">看看大家都在聊什么</text>
        <view class="shortcut-icon-slot" aria-hidden="true"><image wx:if="{{shortcutIconPaths.activities}}" src="{{shortcutIconPaths.activities}}" mode="aspectFit" /></view>
        <view class="shortcut-arrow" aria-hidden="true">›</view>
      </button>
      <button class="home-shortcut home-shortcut--memories" data-action="memories" bindtap="handleHomeShortcut" hover-class="home-shortcut--pressed" aria-label="琐碎回忆，查看成团记忆专题预告">
        <text class="shortcut-title">琐碎回忆</text><text class="shortcut-subtitle">记录第一次成团</text>
        <view class="shortcut-icon-slot" aria-hidden="true"><image wx:if="{{shortcutIconPaths.memories}}" src="{{shortcutIconPaths.memories}}" mode="aspectFit" /></view>
        <view class="shortcut-arrow" aria-hidden="true">›</view>
      </button>
      <view class="home-shortcut home-shortcut--placeholder" aria-hidden="true">
        <text class="shortcut-title">暂定</text><text class="shortcut-subtitle">模块占位</text>
        <view class="shortcut-icon-slot" aria-hidden="true"><image wx:if="{{shortcutIconPaths.placeholder}}" src="{{shortcutIconPaths.placeholder}}" mode="aspectFit" /></view>
      </view>
    </view>

    <view id="hot-pinba-heading" class="home-activity-heading" role="heading" aria-level="2">
      <view class="section-title-row"><text class="section-title">{{hasActiveFilters ? '筛选结果' : '正在组队'}}</text><text wx:if="{{!hasActiveFilters}}" class="section-title-detail">· 全城热拼</text></view>
      <button class="home-section-more" bindtap="handleNavigateToAll" hover-class="home-section-more--pressed" hover-stay-time="80" aria-label="发现更多，点击查看附近活动"><text>发现更多</text><text class="home-section-more-arrow" aria-hidden="true">›</text></button>
    </view>

    <view class="home-activity-stream">
      <view wx:if="{{loading}}" class="home-activity-grid {{largeTextMode ? 'home-activity-grid--large-text' : ''}}" aria-label="正在加载活动">
        <view wx:for="{{[1,2,3]}}" wx:key="*this" class="activity-skeleton-card" aria-hidden="true"><view class="activity-skeleton-owner"><view class="activity-skeleton-avatar"></view><view class="activity-skeleton-line activity-skeleton-line--owner"></view></view><view class="activity-skeleton-line activity-skeleton-line--title"></view><view class="activity-skeleton-line activity-skeleton-line--title-short"></view><view class="activity-skeleton-cover"></view></view>
      </view>
      <view wx:elif="{{activities.length}}" class="home-activity-grid {{largeTextMode ? 'home-activity-grid--large-text' : ''}}">
        <activity-card wx:for="{{activities}}" wx:key="id" item="{{item}}" variant="home-preview" large-text="{{largeTextMode}}" bindselect="handleCardSelect" />
      </view>
      <view wx:else class="empty-state-shell"><empty-state symbol="{{error ? '!' : '+'}}" title="{{error || (hasActiveFilters ? '没有找到合适的活动' : '暂时还没有拼单')}}" description="{{error ? '检查网络后重试。' : (hasActiveFilters ? '换个关键词再试试。' : '发起一个拼单，邀请附近伙伴加入。')}}" action-text="{{error ? '重新加载' : (hasActiveFilters ? '清除筛选' : '去发起拼单')}}" bindaction="handleEmptyAction" /></view>
    </view>

  </view>
</view>
```

FILE: tests/home-time-greeting.test.js
```
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { resolveMacauGreeting } = require('../miniprogram/utils/home-greeting');

const atMacauTime = (hour, minute = 0) => new Date(Date.UTC(2026, 8, 10, hour - 8, minute));

test('首页问候按澳门自然时段覆盖凌晨、早上、上午、中午、下午和晚上', () => {
  const cases = [
    [0, '夜深了'], [4, '夜深了'],
    [5, '早上好'], [8, '早上好'],
    [9, '上午好'], [11, '上午好'],
    [12, '中午好'], [13, '中午好'],
    [14, '下午好'], [17, '下午好'],
    [18, '晚上好'], [23, '晚上好']
  ];
  cases.forEach(([hour, expected]) => assert.equal(resolveMacauGreeting(atMacauTime(hour)), expected));
});

test('首页展示动态问候并在页面载入和每次显示时刷新', () => {
  const script = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/discover/index.js'), 'utf8');
  const template = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/discover/index.wxml'), 'utf8');
  assert.match(template, /\{\{greetingSalutation\}\}，\{\{greetingNickname\}\}/);
  assert.match(script, /syncGreetingSalutation\(\)/);
  assert.ok((script.match(/this\.syncGreetingSalutation\(\)/g) || []).length >= 2);
});
```
</GEMINI_WEB_PROMPT>
