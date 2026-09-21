'use strict';

const MEAL_PROGRESS_CARDS = Object.freeze({
  MEAL_REGISTERED: Object.freeze({
    stage: 'MEAL_REGISTERED',
    activityType: 'food',
    subtype: 'default',
    rank: 0,
    title: '报名成功',
    image: '/subpackages/activity/assets/images/progress-cards/meal/registered.jpg',
    autoEligible: true
  }),
  MEAL_TEAM_READY: Object.freeze({
    stage: 'MEAL_TEAM_READY',
    activityType: 'food',
    subtype: 'default',
    rank: 1,
    title: '饭搭子组队成功',
    image: '/subpackages/activity/assets/images/progress-cards/meal/team-ready.jpg',
    autoEligible: true
  }),
  MEAL_MENU_READY: Object.freeze({
    stage: 'MEAL_MENU_READY',
    activityType: 'food',
    subtype: 'default',
    rank: 2,
    title: '行前点单',
    image: '/subpackages/activity/assets/images/progress-cards/meal/menu-ready.jpg',
    autoEligible: false
  }),
  MEAL_ACTIVE: Object.freeze({
    stage: 'MEAL_ACTIVE',
    activityType: 'food',
    subtype: 'default',
    rank: 3,
    title: '正在开饭',
    image: '/subpackages/activity/assets/images/progress-cards/meal/active.jpg',
    autoEligible: true
  }),
  MEAL_CHECKPOINT: Object.freeze({
    stage: 'MEAL_CHECKPOINT',
    activityType: 'food',
    subtype: 'default',
    rank: 4,
    title: '美味打卡',
    image: '/subpackages/activity/assets/images/progress-cards/meal/checkpoint.jpg',
    autoEligible: false
  }),
  MEAL_FINISHED: Object.freeze({
    stage: 'MEAL_FINISHED',
    activityType: 'food',
    subtype: 'default',
    rank: 5,
    title: '完成聚餐',
    image: '/subpackages/activity/assets/images/progress-cards/meal/finished.jpg',
    autoEligible: true
  })
});

const COMPANION_PROGRESS_CARDS = Object.freeze({
  COMPANION_REGISTERED: Object.freeze({
    stage: 'COMPANION_REGISTERED',
    activityType: 'companion',
    subtype: 'default',
    rank: 0,
    title: '报名成功',
    image: '/subpackages/activity/assets/images/progress-cards/companion/registered.jpg',
    autoEligible: true
  }),
  COMPANION_TEAM_READY: Object.freeze({
    stage: 'COMPANION_TEAM_READY',
    activityType: 'companion',
    subtype: 'default',
    rank: 1,
    title: '组队成功',
    image: '/subpackages/activity/assets/images/progress-cards/companion/team-ready.jpg',
    autoEligible: true
  }),
  COMPANION_TRIP_READY: Object.freeze({
    stage: 'COMPANION_TRIP_READY',
    activityType: 'companion',
    subtype: 'default',
    rank: 2,
    title: '行前整装',
    image: '/subpackages/activity/assets/images/progress-cards/companion/trip-ready.jpg',
    autoEligible: false
  }),
  COMPANION_RAIL_TOGETHER: Object.freeze({
    stage: 'COMPANION_RAIL_TOGETHER',
    activityType: 'companion',
    subtype: 'default',
    rank: 3,
    variantGroup: 'COMPANION_TRANSIT',
    title: '高铁同行',
    image: '/subpackages/activity/assets/images/progress-cards/companion/rail-together.jpg',
    autoEligible: false
  }),
  COMPANION_NIGHT_JOURNEY: Object.freeze({
    stage: 'COMPANION_NIGHT_JOURNEY',
    activityType: 'companion',
    subtype: 'default',
    rank: 3,
    variantGroup: 'COMPANION_TRANSIT',
    title: '夜行途中',
    image: '/subpackages/activity/assets/images/progress-cards/companion/night-journey.jpg',
    autoEligible: false
  })
});

const PROGRESS_CARDS = Object.freeze({
  ...MEAL_PROGRESS_CARDS,
  ...COMPANION_PROGRESS_CARDS
});

const PROGRESS_CARD_REGISTRY = Object.freeze({
  meal: Object.freeze({ default: MEAL_PROGRESS_CARDS }),
  sport: Object.freeze({}),
  companion: Object.freeze({ default: COMPANION_PROGRESS_CARDS })
});

function getProgressCard(stage) {
  return PROGRESS_CARDS[String(stage || '')] || null;
}

module.exports = {
  PROGRESS_CARD_REGISTRY,
  PROGRESS_CARDS,
  MEAL_PROGRESS_CARDS,
  COMPANION_PROGRESS_CARDS,
  getProgressCard
};
