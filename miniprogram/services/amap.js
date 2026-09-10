'use strict';

const config = require('../config/runtime');

const INPUT_TIPS_URL = 'https://restapi.amap.com/v3/assistant/inputtips';
const MOCK_POIS = Object.freeze([
  { id: 'mock-um', name: '澳门大学', district: '路氹填海区', address: '大学大马路', location: '113.543873,22.198745' },
  { id: 'mock-qingmao', name: '青茂口岸', district: '花地玛堂区', address: '鸭涌河南街', location: '113.538100,22.209400' },
  { id: 'mock-tap-seac', name: '塔石体育馆', district: '望德堂区', address: '荷兰园大马路', location: '113.552150,22.199750' },
  { id: 'mock-taipa', name: '氹仔中央公园', district: '嘉模堂区', address: '成都街', location: '113.558300,22.155900' }
]);

function cleanPoi(item) {
  if (!item || typeof item !== 'object') return null;
  const parts = typeof item.location === 'string' ? item.location.split(',').map(Number) : [];
  const longitude = parts[0];
  const latitude = parts[1];
  if (typeof item.name !== 'string' || !item.name.trim()) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < 22.05 || latitude > 22.25 || longitude < 113.45 || longitude > 113.65) return null;
  return {
    poiId: typeof item.id === 'string' ? item.id.slice(0, 80) : '',
    label: item.name.trim().slice(0, 80),
    address: [item.district, item.address].filter((value) => typeof value === 'string' && value.trim()).join(' · ').slice(0, 120),
    latitude,
    longitude,
    coordinateSystem: 'GCJ02',
    provider: 'AMAP'
  };
}

function request(options) {
  return new Promise((resolve, reject) => {
    wx.request({ ...options, success: resolve, fail: reject });
  });
}

async function searchPoi(keyword) {
  const normalized = String(keyword || '').trim().slice(0, 40);
  if (!normalized) return [];
  if (config.useMock) {
    return MOCK_POIS.filter((item) => `${item.name}${item.address}`.includes(normalized)).map(cleanPoi).filter(Boolean);
  }
  if (!config.amapMiniProgramKey) {
    const error = new Error('高德地图尚未配置，请联系管理员');
    error.code = 'AMAP_NOT_CONFIGURED';
    throw error;
  }
  const response = await request({
    url: INPUT_TIPS_URL,
    method: 'GET',
    data: { key: config.amapMiniProgramKey, keywords: normalized, city: '澳门', citylimit: true, datatype: 'all' }
  });
  const body = response && response.data || {};
  if (String(body.status) !== '1') {
    const error = new Error('地点搜索暂时不可用，请稍后重试');
    error.code = 'AMAP_REQUEST_FAILED';
    throw error;
  }
  return (Array.isArray(body.tips) ? body.tips : []).map(cleanPoi).filter(Boolean).slice(0, 20);
}

module.exports = { INPUT_TIPS_URL, cleanPoi, searchPoi };
