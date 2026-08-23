'use strict';

const api = require('./api');

const HIDDEN_KEY = 'pinba_hidden_activity_ids_v1';

function hiddenIds() {
  try {
    return wx.getStorageSync(HIDDEN_KEY) || [];
  } catch (error) {
    return [];
  }
}

async function report(payload) {
  const result = await api.invoke('report.create', payload, { mutating: true });
  if (result.hiddenForReporter && payload.targetType === 'activity') {
    const ids = new Set(hiddenIds());
    ids.add(payload.targetId);
    wx.setStorageSync(HIDDEN_KEY, [...ids]);
  }
  return result;
}

module.exports = {
  report,
  isActivityHidden: (activityId) => hiddenIds().includes(activityId),
  filterHiddenActivities: (items) => items.filter((item) => !hiddenIds().includes(item.id))
};
