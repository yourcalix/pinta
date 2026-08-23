'use strict';

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toDateInput(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toTimeInput(value) {
  const date = new Date(value);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function combineLocal(dateText, timeText) {
  const value = new Date(`${dateText}T${timeText}:00`);
  return value.toISOString();
}

function futureLocal(hours) {
  const date = new Date(Date.now() + hours * 60 * 60 * 1000);
  return {
    date: toDateInput(date),
    time: toTimeInput(date),
    iso: date.toISOString()
  };
}

module.exports = {
  formatDateTime,
  toDateInput,
  toTimeInput,
  combineLocal,
  futureLocal
};
