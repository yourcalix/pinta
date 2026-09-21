'use strict';

const { getProgressCard } = require('../config/progress-cards');

const ELIGIBLE_VIEWER_ROLES = new Set(['owner', 'member']);
const MEAL_STATUS_STAGES = Object.freeze({
  RECRUITING: 'MEAL_REGISTERED',
  FORMED: 'MEAL_TEAM_READY',
  IN_PROGRESS: 'MEAL_ACTIVE',
  COMPLETED: 'MEAL_FINISHED'
});
const COMPANION_STATUS_STAGES = Object.freeze({
  RECRUITING: 'COMPANION_REGISTERED',
  FORMED: 'COMPANION_TEAM_READY'
});
const STATUS_STAGES_BY_ACTIVITY_TYPE = Object.freeze({
  food: MEAL_STATUS_STAGES,
  companion: COMPANION_STATUS_STAGES
});

function isEligibleViewer(activity) {
  if (!activity || typeof activity !== 'object') return false;
  if (ELIGIBLE_VIEWER_ROLES.has(activity.viewerRole)) return true;
  return Boolean(activity.viewerMembership && activity.viewerMembership.status === 'ACTIVE');
}

function resolveProgressStage(activity) {
  if (!activity) return null;
  if (!isEligibleViewer(activity)) return null;
  const statusStages = STATUS_STAGES_BY_ACTIVITY_TYPE[activity.type];
  if (!statusStages) return null;
  const stage = statusStages[activity.status] || null;
  const card = stage && getProgressCard(stage);
  return card && card.activityType === activity.type && card.autoEligible ? stage : null;
}

function resolveDebugProgressStage(activity, requestedStage, enabled) {
  if (!enabled || !activity || !STATUS_STAGES_BY_ACTIVITY_TYPE[activity.type]) return null;
  const card = getProgressCard(requestedStage);
  return card && card.activityType === activity.type ? card.stage : null;
}

module.exports = {
  ELIGIBLE_VIEWER_ROLES,
  MEAL_STATUS_STAGES,
  COMPANION_STATUS_STAGES,
  STATUS_STAGES_BY_ACTIVITY_TYPE,
  isEligibleViewer,
  resolveProgressStage,
  resolveDebugProgressStage
};
