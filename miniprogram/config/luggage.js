'use strict';

const MEMBER_LUGGAGE_OPTIONS = Object.freeze([
  Object.freeze({
    value: 'NONE',
    label: '无行李',
    description: '仅随身小包或普通双肩书包，不占用后备箱'
  }),
  Object.freeze({
    value: 'SMALL',
    label: '小行李',
    description: '20 吋及以下登机箱或手提行李袋'
  }),
  Object.freeze({
    value: 'LARGE',
    label: '大行李',
    description: '24 吋及以上托运箱、超大乐器等'
  })
]);

const MEMBER_LUGGAGE_TYPES = Object.freeze(MEMBER_LUGGAGE_OPTIONS.map((item) => item.value));

module.exports = {
  MEMBER_LUGGAGE_OPTIONS,
  MEMBER_LUGGAGE_TYPES
};
