'use strict';

const crypto = require('crypto');
const { AppError, invariant } = require('./errors');

const COORDINATE_SYSTEM = 'GCJ02';
const DEFAULT_NEARBY_RADIUS_METERS = 3000;
const MAX_NEARBY_RADIUS_METERS = 10000;
const MACAU_BOUNDS = Object.freeze({ minLatitude: 22.05, maxLatitude: 22.25, minLongitude: 113.45, maxLongitude: 113.65 });

function finiteCoordinate(value, field, minimum, maximum) {
  const number = Number(value);
  invariant(Number.isFinite(number) && number >= minimum && number <= maximum, 'VALIDATION_ERROR', `${field}格式无效`, { field });
  return number;
}

function macauCoordinate(latitude, longitude) {
  const point = {
    latitude: finiteCoordinate(latitude, '纬度', -90, 90),
    longitude: finiteCoordinate(longitude, '经度', -180, 180)
  };
  invariant(
    point.latitude >= MACAU_BOUNDS.minLatitude && point.latitude <= MACAU_BOUNDS.maxLatitude
      && point.longitude >= MACAU_BOUNDS.minLongitude && point.longitude <= MACAU_BOUNDS.maxLongitude,
    'VALIDATION_ERROR', '活动地点须位于当前试点区域', { field: 'meetingPoint' }
  );
  return point;
}

function haversineDistanceMeters(left, right) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const lat1 = radians(Number(left.latitude));
  const lat2 = radians(Number(right.latitude));
  const deltaLat = lat2 - lat1;
  const deltaLon = radians(Number(right.longitude) - Number(left.longitude));
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return Math.round(6371008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function nearbyFingerprint(query) {
  return crypto.createHash('sha256').update(JSON.stringify({
    latitude: Number(query.latitude).toFixed(5), longitude: Number(query.longitude).toFixed(5),
    radiusMeters: query.radiusMeters, type: query.type || '', city: query.city || '', district: query.district || ''
  })).digest('base64url').slice(0, 16);
}

function nearbySortTuple(activity) {
  return {
    distanceMeters: Math.max(0, Math.round(Number(activity._distanceMeters))),
    startsAt: String(activity.startsAt || ''),
    id: String(activity.id || '')
  };
}

function compareNearbyTuple(left, right) {
  return Number(left.distanceMeters) - Number(right.distanceMeters)
    || String(left.startsAt).localeCompare(String(right.startsAt))
    || String(left.id).localeCompare(String(right.id));
}

function encodeNearbyCursor(query, after) {
  return Buffer.from(JSON.stringify({ v: 1, a: after, f: nearbyFingerprint(query) })).toString('base64url');
}

function decodeNearbyCursor(value, query) {
  if (value === undefined || value === null || value === '') return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    invariant(parsed && parsed.v === 1 && parsed.a && Number.isSafeInteger(parsed.a.distanceMeters) && parsed.a.distanceMeters >= 0
      && typeof parsed.a.startsAt === 'string' && typeof parsed.a.id === 'string' && parsed.a.id.length <= 80,
    'VALIDATION_ERROR', '分页游标无效', { field: 'cursor' });
    invariant(parsed.f === nearbyFingerprint(query), 'VALIDATION_ERROR', '分页游标与当前筛选条件不匹配', { field: 'cursor' });
    return parsed.a;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('VALIDATION_ERROR', '分页游标无效', { field: 'cursor' });
  }
}

module.exports = {
  COORDINATE_SYSTEM,
  DEFAULT_NEARBY_RADIUS_METERS,
  MAX_NEARBY_RADIUS_METERS,
  MACAU_BOUNDS,
  macauCoordinate,
  haversineDistanceMeters,
  encodeNearbyCursor,
  decodeNearbyCursor,
  nearbySortTuple,
  compareNearbyTuple
};
