'use strict';

const {
  ACTIVITY_STATUS,
  RIDE_FULFILLMENT_STATUS,
  RIDE_MIN_PASSENGERS,
  RIDE_MAX_PASSENGERS
} = require('./constants');

const ACTIVE_RIDE_STATUSES = new Set([
  ACTIVITY_STATUS.RECRUITING,
  ACTIVITY_STATUS.FORMED
]);

function rideCapacity(activity) {
  return activity && activity.type === 'ride'
    ? RIDE_MAX_PASSENGERS
    : Number(activity && (activity.maxPassengers || activity.targetMembers) || 0);
}

function rideThreshold(activity) {
  return activity && activity.type === 'ride'
    ? RIDE_MIN_PASSENGERS
    : Number(activity && (activity.minPassengers || activity.targetMembers) || 0);
}

function isRidePassengerJoinable(activity, at) {
  if (!activity || activity.type !== 'ride' || !ACTIVE_RIDE_STATUSES.has(activity.status)) return false;
  if (Number(activity.memberCount || 0) >= rideCapacity(activity)) return false;
  const now = Date.parse(at);
  const deadline = Date.parse(activity.deadlineAt);
  return Number.isFinite(now) && Number.isFinite(deadline) && deadline > now;
}

function ridePassengerJoinUnavailableReason(activity, at) {
  if (!activity || activity.type !== 'ride') return '当前行程暂不可加入';
  if (activity.status === ACTIVITY_STATUS.CANCELLED) return '行程已取消';
  if (activity.status === ACTIVITY_STATUS.EXPIRED) return '行程已过期';
  if (!ACTIVE_RIDE_STATUSES.has(activity.status)) return '当前行程暂不可加入';
  if (Number(activity.memberCount || 0) >= rideCapacity(activity)) return '行程已满员';
  const now = Date.parse(at);
  const deadline = Date.parse(activity.deadlineAt);
  if (!Number.isFinite(now) || !Number.isFinite(deadline)) return '加入资格暂不可用，请稍后重试';
  if (deadline <= now) return '报名已截止';
  return '';
}

function isRideContactUnlocked(activity, activeMemberCount) {
  if (!activity || activity.type !== 'ride') return true;
  return Number(activeMemberCount || 0) >= rideCapacity(activity);
}

function isRidePassengerLeaveable(activity) {
  return Boolean(
    activity
      && activity.type === 'ride'
      && ACTIVE_RIDE_STATUSES.has(activity.status)
      && activity.rideFulfillment
      && activity.rideFulfillment.status === RIDE_FULFILLMENT_STATUS.UNASSIGNED
  );
}

function rideDriverAvailability(activity, at) {
  if (!activity || activity.type !== 'ride') return { acceptable: false, reason: '该活动不是拼车行程' };
  if (!ACTIVE_RIDE_STATUSES.has(activity.status)) return { acceptable: false, reason: '当前行程暂不可承接' };
  if (!activity.rideFulfillment) return { acceptable: false, reason: '行程接送信息暂不可用' };
  if (activity.rideFulfillment.status !== RIDE_FULFILLMENT_STATUS.UNASSIGNED) {
    return { acceptable: false, reason: '该行程已有司机确认' };
  }
  const now = Date.parse(at);
  const pickupWindowEnd = Date.parse(activity.typeData && activity.typeData.pickupWindowEnd);
  if (!Number.isFinite(now) || !Number.isFinite(pickupWindowEnd) || pickupWindowEnd <= now) {
    return { acceptable: false, reason: '接车时间已到，暂不可承接' };
  }
  return { acceptable: true, reason: '' };
}

function normalizeRideCapacity(activity) {
  if (!activity || activity.type !== 'ride') return activity;
  const next = {
    ...activity,
    targetMembers: RIDE_MIN_PASSENGERS,
    minPassengers: RIDE_MIN_PASSENGERS,
    maxPassengers: RIDE_MAX_PASSENGERS
  };
  if (ACTIVE_RIDE_STATUSES.has(activity.status)) {
    next.status = Number(activity.memberCount || 0) >= RIDE_MAX_PASSENGERS
      ? ACTIVITY_STATUS.FORMED
      : ACTIVITY_STATUS.RECRUITING;
  }
  return next;
}

module.exports = {
  rideCapacity,
  rideThreshold,
  isRidePassengerJoinable,
  ridePassengerJoinUnavailableReason,
  isRidePassengerLeaveable,
  isRideContactUnlocked,
  rideDriverAvailability,
  normalizeRideCapacity
};
