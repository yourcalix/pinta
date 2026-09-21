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

const PROGRESS_CARD_REGISTRY = Object.freeze({
  meal: Object.freeze({ default: MEAL_PROGRESS_CARDS }),
  sport: Object.freeze({}),
  companion: Object.freeze({})
});

function getProgressCard(stage) {
  return MEAL_PROGRESS_CARDS[String(stage || '')] || null;
}

module.exports = {
  PROGRESS_CARD_REGISTRY,
  MEAL_PROGRESS_CARDS,
  getProgressCard
};
