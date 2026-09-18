'use strict';

const config = require('../config/runtime');

const INPUT_TIPS_URL = 'https://restapi.amap.com/v3/assistant/inputtips';
const POI_TEXT_SEARCH_URL = 'https://restapi.amap.com/v3/place/text';
const CHINA_GCJ_BOUNDS = Object.freeze({ minLatitude: 3.86, maxLatitude: 53.55, minLongitude: 73.66, maxLongitude: 135.05 });
const MUNICIPALITIES = Object.freeze(['北京市', '上海市', '天津市', '重庆市']);
const MOCK_POIS = Object.freeze([
  { id: 'mock-um', name: '澳门大学', district: '路氹填海区', address: '大学大马路', location: '113.543873,22.198745' },
  { id: 'mock-qingmao', name: '青茂口岸', district: '花地玛堂区', address: '鸭涌河南街', location: '113.538100,22.209400' },
  { id: 'mock-tap-seac', name: '塔石体育馆', district: '望德堂区', address: '荷兰园大马路', location: '113.552150,22.199750' },
  { id: 'mock-taipa', name: '氹仔中央公园', district: '嘉模堂区', address: '成都街', location: '113.558300,22.155900' }
]);

function textValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseCombinedAdministrativeRegion(value) {
  const combined = textValue(value).replace(/\s+/g, '');
  if (!combined) return { province: '', city: '', district: '' };
  const municipality = MUNICIPALITIES.find((name) => combined.startsWith(name));
  if (municipality) return { province: municipality, city: municipality, district: combined.slice(municipality.length) || municipality };
  const sar = ['澳门特别行政区', '香港特别行政区'].find((name) => combined.startsWith(name));
  if (sar) return { province: sar, city: sar.startsWith('澳门') ? '澳门' : '香港', district: combined.slice(sar.length) || (sar.startsWith('澳门') ? '澳门' : '香港') };
  const provinceMatch = combined.match(/^(.+?(?:省|自治区))/);
  const province = provinceMatch ? provinceMatch[1] : '';
  const rest = province ? combined.slice(province.length) : combined;
  const cityMatch = rest.match(/^(.+?(?:市|自治州|地区|盟))/);
  const city = cityMatch ? cityMatch[1] : '';
  return { province, city, district: city ? rest.slice(city.length) || city : rest };
}

function resolveAdministrativeHierarchy(item) {
  const parsed = parseCombinedAdministrativeRegion(item && item.district);
  const rawProvince = textValue(item && item.pname) || parsed.province;
  const rawCity = textValue(item && item.cityname) || parsed.city;
  const rawDistrict = textValue(item && item.adname) || parsed.district;
  const municipality = MUNICIPALITIES.find((name) => rawProvince === name || rawCity === name || parsed.province === name);
  if (municipality) return { province: municipality, city: municipality, district: (rawDistrict || municipality).slice(0, 30) };
  const sarSource = `${rawProvince}${rawCity}${textValue(item && item.district)}`;
  if (sarSource.includes('澳门') || sarSource.includes('香港')) {
    const macau = sarSource.includes('澳门');
    return {
      province: macau ? '澳门特别行政区' : '香港特别行政区',
      city: macau ? '澳门' : '香港',
      district: (rawDistrict || (macau ? '澳门' : '香港')).slice(0, 30)
    };
  }
  const province = (rawProvince || rawCity || rawDistrict).slice(0, 30);
  const city = (rawCity || rawDistrict || province).slice(0, 30);
  const district = (rawDistrict || city).slice(0, 30);
  return { province, city, district };
}

function cleanPoi(item) {
  if (!item || typeof item !== 'object') return null;
  const parts = typeof item.location === 'string' ? item.location.split(',').map(Number) : [];
  const longitude = parts[0];
  const latitude = parts[1];
  const hierarchy = resolveAdministrativeHierarchy(item);
  if (typeof item.name !== 'string' || !item.name.trim()) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < CHINA_GCJ_BOUNDS.minLatitude || latitude > CHINA_GCJ_BOUNDS.maxLatitude
    || longitude < CHINA_GCJ_BOUNDS.minLongitude || longitude > CHINA_GCJ_BOUNDS.maxLongitude) return null;
  if (!hierarchy.city || !hierarchy.district) return null;
  const adcode = /^\d{6}$/.test(textValue(item.adcode)) ? textValue(item.adcode) : '';
  return {
    poiId: typeof item.id === 'string' ? item.id.slice(0, 80) : '',
    label: item.name.trim().slice(0, 80),
    address: textValue(item.address).slice(0, 120),
    ...hierarchy,
    adcode,
    latitude,
    longitude,
    coordinateSystem: 'GCJ02',
    provider: 'AMAP'
  };
}

function request(options) {
  return new Promise((resolve, reject) => {
    wx.request({
      ...options,
      success: resolve,
      fail() {
        const error = new Error('地点搜索连接失败，请稍后重试');
        error.code = 'AMAP_NETWORK_FAILED';
        reject(error);
      }
    });
  });
}

function createError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function requestCollection(url, data, field) {
  const response = await request({ url, method: 'GET', data });
  if (!response || !Number.isFinite(response.statusCode) || response.statusCode < 200 || response.statusCode >= 300) {
    throw createError('地点搜索暂时不可用，请稍后重试', 'AMAP_REQUEST_FAILED');
  }
  const body = response.data || {};
  if (String(body.status) !== '1') {
    throw createError('地点搜索暂时不可用，请稍后重试', 'AMAP_REQUEST_FAILED');
  }
  if (!Array.isArray(body[field])) {
    throw createError('地点搜索响应异常，请稍后重试', 'AMAP_RESPONSE_INVALID');
  }
  return body[field];
}

async function searchPoi(keyword) {
  const normalized = String(keyword || '').trim().slice(0, 40);
  if (!normalized) return [];
  if (config.useMock) {
    const results = MOCK_POIS
      .filter((item) => `${item.name}${item.address}`.includes(normalized))
      .map((item) => cleanPoi(item))
      .filter(Boolean);
    if (results.length) return results;
    const error = new Error('当前为演示地点数据，暂时无法搜索其他地点');
    error.code = 'AMAP_MOCK_NO_MATCH';
    throw error;
  }
  if (!config.amapMiniProgramKey) {
    throw createError('高德地图尚未配置，请联系管理员', 'AMAP_NOT_CONFIGURED');
  }
  const commonData = {
    key: config.amapMiniProgramKey,
    keywords: normalized
  };
  const tips = await requestCollection(
    INPUT_TIPS_URL,
    { ...commonData, datatype: 'all' },
    'tips'
  );
  const tipResults = tips.map((item) => cleanPoi(item)).filter(Boolean).slice(0, 20);
  if (tipResults.length) return tipResults;

  const pois = await requestCollection(
    POI_TEXT_SEARCH_URL,
    { ...commonData, offset: 20, page: 1, extensions: 'base' },
    'pois'
  );
  const poiResults = pois
    .map((item) => cleanPoi(item))
    .filter(Boolean)
    .slice(0, 20);
  if (poiResults.length) return poiResults;
  if (!tips.length && !pois.length) return [];
  throw createError(
    '搜索到了地点，但暂时无法取得有效坐标，请换个更具体的关键词',
    'AMAP_COORDINATES_UNAVAILABLE'
  );
}

module.exports = { INPUT_TIPS_URL, POI_TEXT_SEARCH_URL, cleanPoi, resolveAdministrativeHierarchy, searchPoi };
