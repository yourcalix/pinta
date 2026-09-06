'use strict';

const MIN_BIRTH_YEAR = 1900;
const DEFAULT_BIRTH_DATE = '2000-01-01';

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function getDaysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function range(start, end) {
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
}

function parseBirthDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_BIRTH_YEAR || month < 1 || month > 12 || day < 1 || day > getDaysInMonth(year, month)) return null;
  return { year, month, day };
}

function macauCalendarDate(now = new Date()) {
  const instant = now instanceof Date ? now : new Date(now);
  const shifted = new Date(instant.getTime() + 8 * 60 * 60 * 1000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function adultBirthLimit(now = new Date()) {
  const today = macauCalendarDate(now);
  return { year: today.year - 18, month: today.month, day: today.day };
}

function compareCalendarDate(left, right) {
  return left.year - right.year || left.month - right.month || left.day - right.day;
}

function calculateAgeOnMacauDate(value, now = new Date()) {
  const birthDate = parseBirthDate(value);
  const today = macauCalendarDate(now);
  if (!birthDate || !Number.isInteger(today.year) || compareCalendarDate(birthDate, today) > 0) return null;
  let age = today.year - birthDate.year;
  if (today.month < birthDate.month || (today.month === birthDate.month && today.day < birthDate.day)) age -= 1;
  return age >= 0 && age <= 150 ? age : null;
}

function formatBirthDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function createPickerState(selected, maxDate) {
  const year = Math.min(Math.max(selected.year, MIN_BIRTH_YEAR), maxDate.year);
  const months = range(1, year === maxDate.year ? maxDate.month : 12);
  const month = Math.min(Math.max(selected.month, 1), months[months.length - 1]);
  const maximumDay = Math.min(getDaysInMonth(year, month), year === maxDate.year && month === maxDate.month ? maxDate.day : 31);
  const days = range(1, maximumDay);
  const day = Math.min(Math.max(selected.day, 1), maximumDay);
  const years = range(MIN_BIRTH_YEAR, maxDate.year);
  return {
    years,
    months,
    days,
    yearIndex: years.indexOf(year),
    monthIndex: months.indexOf(month),
    dayIndex: days.indexOf(day),
    pickerValue: [years.indexOf(year), months.indexOf(month), days.indexOf(day)],
    draft: formatBirthDate(year, month, day),
    maxDate
  };
}

function buildBirthDatePicker(value, now = new Date()) {
  const maxDate = adultBirthLimit(now);
  const selected = parseBirthDate(value) || parseBirthDate(DEFAULT_BIRTH_DATE);
  return createPickerState(selected, maxDate);
}

function updateBirthDatePicker(state, indices) {
  const year = state.years[Math.max(0, Number(indices[0]) || 0)] || state.years[0];
  const month = state.months[Math.max(0, Number(indices[1]) || 0)] || state.months[0];
  const day = state.days[Math.max(0, Number(indices[2]) || 0)] || state.days[0];
  return createPickerState({ year, month, day }, state.maxDate);
}

module.exports = {
  MIN_BIRTH_YEAR,
  DEFAULT_BIRTH_DATE,
  getDaysInMonth,
  parseBirthDate,
  calculateAgeOnMacauDate,
  adultBirthLimit,
  buildBirthDatePicker,
  updateBirthDatePicker
};
