'use strict';

const { invariant } = require('./errors');

const PHONE_PATTERNS = Object.freeze({
  '+853': /^6\d{7}$/,
  '+86': /^1\d{10}$/,
  '+852': /^[569]\d{7}$/
});

function normalizeRidePhone(value, field = '本人联系电话') {
  const compact = typeof value === 'string'
    ? value.trim().replace(/[\s()-]+/g, '').replace(/^00/, '+')
    : '';
  const region = Object.keys(PHONE_PATTERNS).find((prefix) => compact.startsWith(prefix));
  const digits = region ? compact.slice(region.length) : '';
  invariant(
    Boolean(region) && PHONE_PATTERNS[region].test(digits),
    'VALIDATION_ERROR',
    '请输入正确的联系电话',
    { field }
  );
  return `${region}${digits}`;
}

module.exports = { PHONE_PATTERNS, normalizeRidePhone };
