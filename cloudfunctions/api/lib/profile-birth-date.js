'use strict';

const MIN_BIRTH_YEAR = 1900;

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function getDaysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseBirthDate(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_BIRTH_YEAR || month < 1 || month > 12) return null;
  if (day < 1 || day > getDaysInMonth(year, month)) return null;
  return { year, month, day };
}

function macauCalendarDate(now = new Date()) {
  const instant = now instanceof Date ? now : new Date(now);
  const shifted = new Date(instant.getTime() + 8 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate()
  };
}

function adultBirthLimit(now = new Date()) {
  const today = macauCalendarDate(now);
  return { year: today.year - 18, month: today.month, day: today.day };
}

function compareCalendarDate(left, right) {
  return left.year - right.year || left.month - right.month || left.day - right.day;
}

module.exports = {
  MIN_BIRTH_YEAR,
  getDaysInMonth,
  parseBirthDate,
  adultBirthLimit,
  compareCalendarDate
};
