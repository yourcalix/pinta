'use strict';

const { formatDateTime, toTimeInput } = require('./date');
const { getRideRoute } = require('../config/locations');

const TYPE_META = Object.freeze({
  ride: { label: '拼车', icon: '↗', color: '#3478F6' },
  product: { label: '拼商品', icon: '□', color: '#F59E0B' },
  buddy: { label: '拼搭子', icon: '○', color: '#7C5CFC' }
});

const STATUS_META = Object.freeze({
  RECRUITING: { label: '招募中', tone: 'success' },
  FORMED: { label: '已成团', tone: 'info' },
  IN_PROGRESS: { label: '进行中', tone: 'info' },
  COMPLETED: { label: '已完成', tone: 'muted' },
  CANCELLED: { label: '已取消', tone: 'muted' },
  EXPIRED: { label: '已过期', tone: 'muted' },
  SUSPENDED: { label: '已下架', tone: 'danger' }
});

function locationLabel(value) {
  if (value && typeof value === 'object') return value.label || '';
  return typeof value === 'string' ? value : '';
}

function sameCalendarDay(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function rideTimeWindow(startsAt, endsAt) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const startLabel = formatDateTime(startsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return startLabel;
  if (sameCalendarDay(start, end)) return `${startLabel}–${toTimeInput(end)}`;
  const nextDay = new Date(start);
  nextDay.setDate(nextDay.getDate() + 1);
  if (sameCalendarDay(nextDay, end)) return `${startLabel}–次日${toTimeInput(end)}`;
  return `${startLabel}–${formatDateTime(endsAt)}`;
}

function passengerAvatarSlots(memberCount, maxPassengers) {
  const total = Math.min(4, Math.max(1, maxPassengers));
  const occupied = Math.min(total, Math.max(0, memberCount));
  return Array.from({ length: total }, (_, index) => ({
    id: index + 1,
    kind: index >= occupied ? 'empty' : (index % 2 === 0 ? 'a' : 'b')
  }));
}

function decorateActivity(activity) {
  const typeMeta = TYPE_META[activity.type] || TYPE_META.buddy;
  const statusMeta = STATUS_META[activity.status] || STATUS_META.EXPIRED;
  const memberCount = Math.max(0, Number(activity.memberCount) || 0);
  const targetMembers = Math.max(1, Number(activity.targetMembers) || 1);
  const maxPassengers = activity.type === 'ride'
    ? Math.max(targetMembers, Number(activity.maxPassengers) || targetMembers)
    : targetMembers;
  const remaining = Math.max(0, maxPassengers - memberCount);
  const minPassengers = activity.type === 'ride'
    ? Math.max(1, Number(activity.minPassengers) || targetMembers)
    : targetMembers;
  const remainingToForm = Math.max(0, minPassengers - memberCount);
  const progressPercent = Math.min(100, Math.round(memberCount / maxPassengers * 100));
  const applicationStatus = activity.viewerApplication && activity.viewerApplication.status;
  const canReapply = ['REJECTED', 'WITHDRAWN', 'LEFT', 'EXPIRED', 'CANCELLED_BY_ACTIVITY'].includes(applicationStatus);
  const canApplyStatus = activity.type === 'ride' ? activity.rideJoinable === true : activity.status === 'RECRUITING';
  const canApply = activity.type === 'ride'
    ? activity.canJoinRide === true
    : canApplyStatus && (activity.viewerRole === 'guest' || (activity.viewerRole === 'applicant' && canReapply));
  const joinUnavailableTip = activity.type === 'ride'
    ? typeof activity.canJoinRide !== 'boolean'
      ? '服务更新中，请刷新后重试'
      : activity.joinUnavailableReason || '当前行程暂不可加入'
    : '';
  let sceneLine = activity.placeLabel;
  const typeData = activity.typeData || {};
  const route = activity.type === 'ride' ? getRideRoute(typeData.routeId) : null;
  const originLabel = activity.type === 'ride' ? (locationLabel(typeData.origin) || (route && route.origin) || '') : '';
  const destinationLabel = activity.type === 'ride' ? (locationLabel(typeData.destination) || (route && route.destination) || '') : '';
  if (activity.type === 'ride') sceneLine = `${originLabel} → ${destinationLabel}`;
  if (activity.type === 'product') sceneLine = `${activity.typeData.productName} · 目标 ${activity.typeData.targetQuantity} 件`;
  if (activity.type === 'buddy') sceneLine = `${activity.typeData.category} · ${activity.placeLabel}`;
  const displayTime = formatDateTime(activity.startsAt);
  const timeWindowLabel = activity.type === 'ride'
    ? rideTimeWindow(activity.startsAt, typeData.pickupWindowEnd)
    : displayTime;
  let statusLabel = statusMeta.label;
  let statusTone = statusMeta.tone;
  if (activity.type === 'ride' && ['RECRUITING', 'FORMED'].includes(activity.status)) {
    statusLabel = remaining === 0 ? '已满员' : '招募中';
    statusTone = remaining === 0 ? 'muted' : 'success';
  }
  const fulfillment = activity.rideFulfillment || {};
  const departureDelta = Date.parse(activity.startsAt) - Date.now();
  const startsSoon = departureDelta >= 0 && departureDelta <= 30 * 60 * 1000;
  let driverStatusLabel = '';
  let driverStatusTone = 'info';
  if (activity.type === 'ride') {
    if (fulfillment.status === 'ASSIGNED') {
      const pickupTime = fulfillment.pickupAt ? formatDateTime(fulfillment.pickupAt).split(' ').pop() : '';
      driverStatusLabel = pickupTime ? `司机已确认 ${pickupTime}` : '司机已确认';
    } else if (activity.driverAcceptable) {
      driverStatusLabel = startsSoon ? '临近出发·暂无司机' : '待司机确认';
      driverStatusTone = startsSoon ? 'danger' : 'info';
    }
  }
  const availability = canApplyStatus ? `剩余${remaining}个座位` : statusLabel;
  return {
    ...activity,
    typeLabel: typeMeta.label,
    typeColor: typeMeta.color,
    typeIcon: typeMeta.icon,
    statusLabel,
    statusTone,
    displayTime,
    sceneLine,
    memberCount,
    remaining,
    remainingToForm,
    maxPassengers,
    routeCode: typeData.routeCode || (route && route.code) || typeMeta.label,
    originLabel,
    destinationLabel,
    originLocationId: (typeData.origin && typeData.origin.id) || (route && route.originId) || '',
    destinationLocationId: (typeData.destination && typeData.destination.id) || (route && route.destinationId) || '',
    timeWindowLabel,
    avatarSlots: passengerAvatarSlots(memberCount, maxPassengers),
    progressPercent,
    canApply,
    joinUnavailableTip,
    capacityLabel: `已有 ${memberCount} 人 · 最多 ${maxPassengers} 人`,
    driverStatusLabel,
    driverStatusTone,
    accessibilityLabel: `${typeMeta.label}，${activity.title}，${statusLabel}，${timeWindowLabel}，${sceneLine}，${availability}${driverStatusLabel ? `，${driverStatusLabel}` : ''}，双击查看行程`
  };
}

module.exports = {
  TYPE_META,
  STATUS_META,
  decorateActivity
};
