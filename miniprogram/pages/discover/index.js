'use strict';

const activityService = require('../../services/activity');
const safetyService = require('../../services/safety');
const { decorateActivity } = require('../../utils/display');
const { calculateContentTopInset } = require('../../utils/navigation-layout');
const {
  mergeActivitiesById,
  expirationSchedule,
  removeLocallyExpiredRecruiting
} = require('../../utils/discover-list');
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

const PAGE_SIZE = 10;
const BANNER_ROUTE_WHITELIST = new Set(['/pages/publish/index']);
const MEMORY_COVERS = Object.freeze({
  companion: '/assets/images/publish/publish-cover-companion.png',
  sport: '/assets/images/publish/publish-cover-sport.png',
  food: '/assets/images/publish/publish-cover-food.png'
});
const CAMPAIGN_BANNERS = Object.freeze([
  {
    id: 'weekend-sport',
    tone: 'sport',
    eyebrow: '周末提案',
    title: '周末羽毛球新人局',
    subtitle: '新手友好 · 一起轻松开打',
    imageSrc: MEMORY_COVERS.sport,
    action: { kind: 'filter', value: 'sport' }
  },
  {
    id: 'city-walk',
    tone: 'companion',
    eyebrow: '结伴探索',
    title: '发现城市里的新路线',
    subtitle: '周末漫步 · 找到同频搭子',
    imageSrc: MEMORY_COVERS.companion,
    action: { kind: 'filter', value: 'companion' }
  },
  {
    id: 'publish-guide',
    tone: 'guide',
    eyebrow: '拼吧指南',
    title: '第一次发起拼单？',
    subtitle: '填写真实信息 · 安心结伴同行',
    imageSrc: MEMORY_COVERS.food,
    action: { kind: 'route', value: '/pages/publish/index' }
  }
]);

function hasActiveFilters(filters) {
  return Boolean(filters.type || filters.appliedKeyword);
}

function memoryDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function decorateMemory(activity, index) {
  const decorated = decorateActivity(activity);
  const formedDate = memoryDate(activity.formedAt || activity.updatedAt || activity.startsAt);
  const ownerSlot = decorated.visibleAvatarSlots.find((slot) => !slot.empty) || null;
  return {
    ...decorated,
    memoryCoverSrc: MEMORY_COVERS[decorated.typeTone] || MEMORY_COVERS.sport,
    memoryCoverFailed: false,
    memoryFact: `${decorated.memberCount}人成团${formedDate ? ` · ${formedDate}` : ''}`,
    memoryOwnerAvatar: ownerSlot && ownerSlot.src || '',
    memoryPosition: index === 0 ? 'lead' : index === 1 ? 'top' : index === 2 ? 'bottom' : 'extra'
  };
}

function memoryViewState(memories, expanded) {
  const visibleMemories = expanded ? memories : memories.slice(0, 3);
  return {
    visibleMemories,
    featuredMemories: visibleMemories.slice(0, 3),
    extraMemories: visibleMemories.slice(3),
    memoryLayout: memories.length ? 3 : 0,
    hasMoreMemories: memories.length > 3
  };
}

Page({
  data: {
    banners: CAMPAIGN_BANNERS.map((item) => ({ ...item, failed: false })),
    currentBanner: 0,
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
    nextCursor: '',
    hasMore: true,
    loading: true,
    refreshing: false,
    loadingMore: false,
    loadMoreError: '',
    error: '',
    memories: [],
    visibleMemories: [],
    featuredMemories: [],
    extraMemories: [],
    memoryLayout: 0,
    hasMoreMemories: false,
    memoriesExpanded: false,
    contentTopInset: 88,
    launchSplashVisible: false,
    launchSplashExiting: false,
    launchProgress: 0
  },

  onLoad() {
    this.setData({
      contentTopInset: calculateContentTopInset(typeof wx === 'undefined' ? null : wx)
    });
    this._skipFirstShow = true;
    this.startLaunchSplash();
    const activities = Promise.resolve(this.fetchActivities({ mode: 'replace' }))
      .finally(() => this.markLaunchSplashReady());
    return Promise.allSettled([activities, this.fetchMemories()]);
  },

  onShow() {
    selectTab(this, 0);
    if (this._skipFirstShow) {
      this._skipFirstShow = false;
      return;
    }
    return Promise.allSettled([
      this.fetchActivities({ mode: 'replace', keepContent: true }),
      this.fetchMemories({ keepContent: true })
    ]);
  },

  onHide() {
    this._loadSeq = (this._loadSeq || 0) + 1;
    this._memorySeq = (this._memorySeq || 0) + 1;
    this.clearExpirationTimer();
    this.teardownLaunchSplash(true);
  },

  onUnload() {
    this._loadSeq = (this._loadSeq || 0) + 1;
    this._memorySeq = (this._memorySeq || 0) + 1;
    this.clearExpirationTimer();
    this.teardownLaunchSplash(false);
  },

  async onPullDownRefresh() {
    try {
      await Promise.allSettled([
        this.fetchActivities({ mode: 'replace', keepContent: true, notifyFailure: true }),
        this.fetchMemories({ keepContent: true })
      ]);
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async fetchMemories(options = {}) {
    const requestSeq = (this._memorySeq = (this._memorySeq || 0) + 1);
    try {
      const result = await activityService.memories();
      if (requestSeq !== this._memorySeq) return false;
      const memories = safetyService
        .filterHiddenActivities(result.items || [])
        .filter((item) => item && item.status === 'FORMED')
        .map(decorateMemory);
      const memoriesExpanded = options.keepContent === true && this.data.memoriesExpanded && memories.length > 3;
      this.setData({
        memories,
        memoriesExpanded,
        ...memoryViewState(memories, memoriesExpanded)
      });
      return true;
    } catch (error) {
      if (requestSeq !== this._memorySeq) return false;
      if (!options.keepContent) {
        this.setData({
          memories: [],
          memoriesExpanded: false,
          ...memoryViewState([], false)
        });
      }
      return false;
    }
  },

  onReachBottom() {
    if (this.data.loading || this.data.refreshing || this.data.loadingMore || !this.data.hasMore || this.data.error) return;
    this.fetchActivities({ mode: 'append' });
  },

  async fetchActivities(options = {}) {
    const mode = options.mode === 'append' ? 'append' : 'replace';
    const isAppend = mode === 'append';
    const keepContent = options.keepContent === true;
    const allowAutoFill = options.allowAutoFill !== false;
    if (isAppend && (
      this.data.loading
      || this.data.refreshing
      || this.data.loadingMore
      || !this.data.hasMore
      || !this.data.nextCursor
    )) return false;

    let loadSeq;
    let cursor;
    if (isAppend) {
      this._loadSeq = this._loadSeq || 0;
      loadSeq = this._loadSeq;
      cursor = this.data.nextCursor;
      this.setData({
        loading: this.data.activities.length === 0,
        loadingMore: true,
        loadMoreError: ''
      });
    } else {
      loadSeq = (this._loadSeq = (this._loadSeq || 0) + 1);
      this.clearExpirationTimer();
      const resetContent = !keepContent;
      this.setData({
        loading: resetContent || this.data.activities.length === 0,
        refreshing: true,
        loadingMore: false,
        loadMoreError: '',
        error: '',
        ...(resetContent ? { activities: [], nextCursor: '', hasMore: true } : {})
      });
    }

    try {
      const result = await activityService.list({
        type: this.data.type || undefined,
        keyword: this.data.appliedKeyword || undefined,
        limit: PAGE_SIZE,
        cursor: isAppend ? cursor : undefined
      });
      if (loadSeq !== this._loadSeq) return false;

      const incoming = safetyService
        .filterHiddenActivities(result.items || [])
        .map(decorateActivity);
      const nextCursor = result.nextCursor ? String(result.nextCursor) : '';
      const hasMore = Boolean(nextCursor);
      const activities = isAppend
        ? mergeActivitiesById(this.data.activities, incoming)
        : incoming;
      this.setData({
        activities,
        nextCursor,
        hasMore,
        loading: false,
        refreshing: false,
        loadingMore: false,
        loadMoreError: '',
        error: ''
      });

      if (activities.length === 0 && hasMore && allowAutoFill) {
        return this.fetchActivities({ mode: 'append', allowAutoFill: false });
      }
      this.scheduleExpirationRefresh(activities);
      return true;
    } catch (error) {
      if (loadSeq !== this._loadSeq) return false;
      if (isAppend) {
        this.setData({
          loading: false,
          loadingMore: false,
          loadMoreError: '加载更多失败，请重试'
        });
        this.scheduleExpirationRefresh(this.data.activities);
        return false;
      }

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

  handleBannerChange(event) {
    const currentBanner = Math.max(0, Number(event.detail && event.detail.current) || 0);
    if (currentBanner !== this.data.currentBanner) this.setData({ currentBanner });
  },

  handleBannerTap(event) {
    const banner = this.data.banners.find((item) => item.id === event.currentTarget.dataset.id);
    if (!banner || !banner.action) return false;
    if (banner.action.kind === 'filter' && ['', 'companion', 'sport', 'food'].includes(banner.action.value)) {
      const type = banner.action.value;
      this.setData({ type, hasActiveFilters: hasActiveFilters({ ...this.data, type }) });
      return this.fetchActivities({ mode: 'replace' });
    }
    if (banner.action.kind === 'route' && BANNER_ROUTE_WHITELIST.has(banner.action.value)) {
      wx.switchTab({ url: banner.action.value });
      return true;
    }
    return false;
  },

  handleBannerImageError(event) {
    const id = event.currentTarget.dataset.id;
    const index = this.data.banners.findIndex((item) => item.id === id);
    if (index < 0 || this.data.banners[index].failed) return;
    this.setData({ [`banners[${index}].failed`]: true });
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

  handleMemorySelect(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({
      url: `/subpackages/activity/detail/index?id=${encodeURIComponent(id)}`
    });
  },

  handleMemoryCoverError(event) {
    const id = event.currentTarget.dataset.id;
    const index = this.data.memories.findIndex((item) => item.id === id);
    if (index < 0 || this.data.memories[index].memoryCoverFailed) return;
    const memories = this.data.memories.map((item, itemIndex) => itemIndex === index
      ? { ...item, memoryCoverFailed: true }
      : item);
    this.setData({
      memories,
      ...memoryViewState(memories, this.data.memoriesExpanded)
    });
  },

  handleToggleMemories() {
    if (!this.data.hasMoreMemories) return false;
    const memoriesExpanded = !this.data.memoriesExpanded;
    this.setData({
      memoriesExpanded,
      ...memoryViewState(this.data.memories, memoriesExpanded)
    });
    return true;
  },

  handleEmptyAction() {
    if (this.data.error) return this.fetchActivities({ mode: 'replace' });
    if (this.data.hasActiveFilters) return this.handleClearFilters();
    if (this.data.hasMore) return this.fetchActivities({ mode: 'append', allowAutoFill: false });
    wx.switchTab({ url: '/pages/publish/index' });
  },

  handleRetryLoadMore() {
    this.fetchActivities({ mode: 'append', allowAutoFill: false });
  }
});
