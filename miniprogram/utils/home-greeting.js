'use strict';

const BEIJING_UTC_OFFSET_HOURS = 8;
function beijingHour(now = new Date()) {
  const value = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(value.getTime())) return 9;
  return (value.getUTCHours() + BEIJING_UTC_OFFSET_HOURS) % 24;
}

function resolveBeijingGreeting(now = new Date()) {
  const hour = beijingHour(now);
  if (hour < 5) return '夜深了';
  if (hour < 9) return '早上好';
  if (hour < 12) return '上午好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

module.exports = {
  resolveBeijingGreeting
};
