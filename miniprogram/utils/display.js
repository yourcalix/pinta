'use strict';

const { formatDateTime } = require('./date');

const TYPE_META = Object.freeze({
  companion: { label: '拼同行', icon: '↗', color: '#3D7FD6', tone: 'companion' },
  sport: { label: '拼运动', icon: '●', color: '#705CC8', tone: 'sport' },
  food: { label: '拼饭桌', icon: '⌂', color: '#E8873A', tone: 'food' },
  ride: { label: '拼同行', icon: '↗', color: '#3D7FD6', tone: 'companion' },
  buddy: { label: '拼运动', icon: '●', color: '#705CC8', tone: 'sport' },
  product: { label: '拼饭桌', icon: '⌂', color: '#E8873A', tone: 'food' }
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

function legacyLocation(typeData = {}) {
  const origin = typeData.origin && typeData.origin.label || typeData.originLabel || '';
  const destination = typeData.destination && typeData.destination.label || typeData.destinationLabel || '';
  return origin && destination ? `${origin} → ${destination}` : '';
}

function typeSummary(activity) {
  const data = activity.typeData || {};
  if (['companion', 'ride'].includes(activity.type)) return legacyLocation(data) || activity.placeLabel;
  if (['sport', 'buddy'].includes(activity.type)) return `${data.sportType || data.category || '运动活动'} · ${data.venue || activity.placeLabel}`;
  if (['food', 'product'].includes(activity.type)) return `${data.venue || activity.placeLabel} · ${data.cuisine || data.productName || '一起吃饭'}`;
  return activity.placeLabel;
}

function decorateActivity(activity) {
  const typeMeta = TYPE_META[activity.type] || TYPE_META.sport;
  const statusMeta = STATUS_META[activity.status] || STATUS_META.EXPIRED;
  const memberCount = Math.max(0, Number(activity.memberCount) || 0);
  const maxMembers = Math.max(2, Number(activity.maxMembers || activity.maxPassengers || activity.targetMembers) || 2);
  const minMembers = Math.min(maxMembers, Math.max(2, Number(activity.minMembers || activity.minPassengers || 2) || 2));
  const remaining = Math.max(0, maxMembers - memberCount);
  const progressPercent = Math.min(100, Math.round(memberCount / maxMembers * 100));
  const statusLabel = activity.status === 'RECRUITING' && remaining === 0 ? '已满员' : statusMeta.label;
  const applicationStatus = activity.viewerApplication && activity.viewerApplication.status;
  const canReapply = ['REJECTED', 'WITHDRAWN', 'LEFT', 'EXPIRED', 'CANCELLED_BY_ACTIVITY'].includes(applicationStatus);
  const canApply = !(activity.legacy && activity.legacy.readOnly) && activity.status === 'RECRUITING' && remaining > 0
    && (activity.viewerRole === 'guest' || (activity.viewerRole === 'applicant' && canReapply));
  const summary = typeSummary(activity);
  const ownerNickname = String(activity.owner && activity.owner.nickname || '拼吧用户').trim() || '拼吧用户';
  return {
    ...activity,
    typeLabel: typeMeta.label,
    typeColor: typeMeta.color,
    typeTone: typeMeta.tone,
    typeIcon: typeMeta.icon,
    statusLabel,
    statusTone: statusMeta.tone,
    displayTime: formatDateTime(activity.startsAt),
    sceneLine: summary,
    memberCount,
    maxMembers,
    minMembers,
    remaining,
    progressPercent,
    canApply,
    capacityLabel: `${memberCount}/${maxMembers} 人`,
    ownerNickname,
    ownerInitial: Array.from(ownerNickname)[0] || '拼',
    accessibilityLabel: `${typeMeta.label}活动，${activity.title}，${statusLabel}，${formatDateTime(activity.startsAt)}，${summary}，已有${memberCount}人，最多${maxMembers}人，双击查看详情`
  };
}

module.exports = { TYPE_META, STATUS_META, decorateActivity };
