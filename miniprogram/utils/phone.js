'use strict';

const PHONE_REGION_OPTIONS = Object.freeze([
  { code: '+853', label: '澳门 +853', pattern: /^6\d{7}$/, placeholder: '请输入 8 位澳门手机号' },
  { code: '+86', label: '中国内地 +86', pattern: /^1\d{10}$/, placeholder: '请输入 11 位手机号' },
  { code: '+852', label: '香港 +852', pattern: /^[569]\d{7}$/, placeholder: '请输入 8 位香港手机号' }
]);

function phoneDigits(value) {
  return typeof value === 'string' ? value.replace(/\D+/g, '') : '';
}

function phoneOption(regionCode) {
  return PHONE_REGION_OPTIONS.find((item) => item.code === regionCode) || PHONE_REGION_OPTIONS[0];
}

function isPhoneValid(regionCode, value) {
  return phoneOption(regionCode).pattern.test(phoneDigits(value));
}

function buildPhone(regionCode, value) {
  return `${phoneOption(regionCode).code}${phoneDigits(value)}`;
}

function spokenPhone(value) {
  return String(value || '').replace('+', '加 ').split('').join(' ');
}

module.exports = {
  PHONE_REGION_OPTIONS,
  phoneDigits,
  phoneOption,
  isPhoneValid,
  buildPhone,
  spokenPhone
};
