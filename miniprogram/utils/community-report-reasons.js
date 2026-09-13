'use strict';

const COMMUNITY_REPORT_REASONS = Object.freeze([
  Object.freeze({ label: '虚假或误导信息', value: 'FALSE_INFORMATION' }),
  Object.freeze({ label: '诈骗或广告导流', value: 'FRAUD_OR_DIVERSION' }),
  Object.freeze({ label: '骚扰或不当内容', value: 'HARASSMENT' }),
  Object.freeze({ label: '其他问题', value: 'OTHER' })
]);

module.exports = { COMMUNITY_REPORT_REASONS };
