'use strict';

const { formatDateTime } = require('./date');

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

function decorateActivity(activity) {
  const typeMeta = TYPE_META[activity.type] || TYPE_META.buddy;
  const statusMeta = STATUS_META[activity.status] || STATUS_META.EXPIRED;
  const memberCount = Math.max(0, Number(activity.memberCount) || 0);
  const targetMembers = Math.max(1, Number(activity.targetMembers) || 1);
  const remaining = Math.max(0, targetMembers - memberCount);
  const progressPercent = Math.min(100, Math.round(memberCount / targetMembers * 100));
  const applicationStatus = activity.viewerApplication && activity.viewerApplication.status;
  const canReapply = ['REJECTED', 'WITHDRAWN', 'LEFT', 'EXPIRED', 'CANCELLED_BY_ACTIVITY'].includes(applicationStatus);
  const canApply = activity.status === 'RECRUITING'
    && (activity.viewerRole === 'guest' || (activity.viewerRole === 'applicant' && canReapply));
  let sceneLine = activity.placeLabel;
  if (activity.type === 'ride') sceneLine = `${activity.typeData.origin} → ${activity.typeData.destination}`;
  if (activity.type === 'product') sceneLine = `${activity.typeData.productName} · 目标 ${activity.typeData.targetQuantity} 件`;
  if (activity.type === 'buddy') sceneLine = `${activity.typeData.category} · ${activity.placeLabel}`;
  const displayTime = formatDateTime(activity.startsAt);
  const availability = activity.status === 'RECRUITING' ? `还差${remaining}人` : statusMeta.label;
  return {
    ...activity,
    typeLabel: typeMeta.label,
    typeColor: typeMeta.color,
    typeIcon: typeMeta.icon,
    statusLabel: statusMeta.label,
    statusTone: statusMeta.tone,
    displayTime,
    sceneLine,
    remaining,
    progressPercent,
    canApply,
    accessibilityLabel: `${typeMeta.label}，${activity.title}，${statusMeta.label}，${displayTime}，${activity.district} ${activity.placeLabel}，${availability}`
  };
}

module.exports = {
  TYPE_META,
  STATUS_META,
  decorateActivity
};
