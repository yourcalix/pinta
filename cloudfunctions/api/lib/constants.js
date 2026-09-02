'use strict';

const ACTIVITY_TYPES = Object.freeze(['companion', 'sport', 'food']);
const LEGACY_ACTIVITY_TYPE_MAP = Object.freeze({
  ride: 'companion',
  buddy: 'sport',
  product: 'food'
});
const PILOT_CITY = '澳门';
const PILOT_DISTRICTS = Object.freeze(['澳门校园']);
const MACAU_RIDE_ROUTES = Object.freeze([
  Object.freeze({ id: 'QINGMAO_TO_TAIPA', code: '青城', originId: 'QINGMAO', originLabel: '青茂口岸', destinationId: 'TAIPA_CAMPUS', destinationLabel: '凼仔校区' }),
  Object.freeze({ id: 'HENGQIN_TO_TAIPA', code: '琴城', originId: 'HENGQIN', originLabel: '横琴口岸', destinationId: 'TAIPA_CAMPUS', destinationLabel: '凼仔校区' }),
  Object.freeze({ id: 'QINGMAO_TO_GOLDEN_DRAGON', code: '青龍', originId: 'QINGMAO', originLabel: '青茂口岸', destinationId: 'GOLDEN_DRAGON_CAMPUS', destinationLabel: '金龙校区' }),
  Object.freeze({ id: 'HENGQIN_TO_GOLDEN_DRAGON', code: '琴龍', originId: 'HENGQIN', originLabel: '横琴口岸', destinationId: 'GOLDEN_DRAGON_CAMPUS', destinationLabel: '金龙校区' }),
  Object.freeze({ id: 'TAIPA_TO_QINGMAO', code: '城青', originId: 'TAIPA_CAMPUS', originLabel: '凼仔校区', destinationId: 'QINGMAO', destinationLabel: '青茂口岸' }),
  Object.freeze({ id: 'TAIPA_TO_HENGQIN', code: '城琴', originId: 'TAIPA_CAMPUS', originLabel: '凼仔校区', destinationId: 'HENGQIN', destinationLabel: '横琴口岸' }),
  Object.freeze({ id: 'GOLDEN_DRAGON_TO_QINGMAO', code: '龍青', originId: 'GOLDEN_DRAGON_CAMPUS', originLabel: '金龙校区', destinationId: 'QINGMAO', destinationLabel: '青茂口岸' }),
  Object.freeze({ id: 'GOLDEN_DRAGON_TO_HENGQIN', code: '龍琴', originId: 'GOLDEN_DRAGON_CAMPUS', originLabel: '金龙校区', destinationId: 'HENGQIN', destinationLabel: '横琴口岸' })
]);
const MACAU_RIDE_ROUTE_IDS = Object.freeze(MACAU_RIDE_ROUTES.map((route) => route.id));
const MACAU_RIDE_CAMPUSES = Object.freeze([
  Object.freeze({ id: 'TAIPA_CAMPUS', label: '凼仔校区' }),
  Object.freeze({ id: 'GOLDEN_DRAGON_CAMPUS', label: '金龙校区' })
]);
const MACAU_RIDE_CAMPUS_IDS = Object.freeze(MACAU_RIDE_CAMPUSES.map((campus) => campus.id));
const MACAU_RIDE_ROUTE_IDS_BY_CAMPUS = Object.freeze(Object.fromEntries(
  MACAU_RIDE_CAMPUS_IDS.map((campusId) => [campusId, Object.freeze(MACAU_RIDE_ROUTES
    .filter((route) => route.originId === campusId || route.destinationId === campusId)
    .map((route) => route.id))])
));
const ACTIVITY_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  RECRUITING: 'RECRUITING',
  FORMED: 'FORMED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  SUSPENDED: 'SUSPENDED'
});
const APPLICATION_STATUS = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
  LEFT: 'LEFT',
  EXPIRED: 'EXPIRED',
  CANCELLED_BY_ACTIVITY: 'CANCELLED_BY_ACTIVITY'
});
const MEMBER_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  LEFT: 'LEFT',
  REMOVED: 'REMOVED'
});
const USER_GENDERS = Object.freeze(['MALE', 'FEMALE']);
const PASSENGER_AVATAR_KINDS = Object.freeze(['PASSENGER_A', 'PASSENGER_B']);
const MEMBER_LUGGAGE_TYPES = Object.freeze(['NONE', 'SMALL', 'LARGE']);
const COMPANION_TIME_FLEXIBILITY = Object.freeze(['ON_TIME', 'WITHIN_30_MIN', 'WITHIN_60_MIN']);
const COMPANION_TRANSPORT_PREFERENCES = Object.freeze(['PUBLIC_TRANSIT', 'LICENSED_TAXI', 'DISCUSS_AFTER_FORMED']);
const SPORT_LEVELS = Object.freeze(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'ANY']);
const SPORT_INTENSITIES = Object.freeze(['LIGHT', 'MEDIUM', 'HIGH']);
const REPORT_REASONS = Object.freeze([
  'FALSE_INFORMATION',
  'ILLEGAL_SERVICE_SOLICITATION',
  'FRAUD_OR_DIVERSION',
  'HARASSMENT',
  'OTHER'
]);

module.exports = {
  ACTIVITY_TYPES,
  LEGACY_ACTIVITY_TYPE_MAP,
  PILOT_CITY,
  PILOT_DISTRICTS,
  MACAU_RIDE_ROUTES,
  MACAU_RIDE_ROUTE_IDS,
  MACAU_RIDE_CAMPUSES,
  MACAU_RIDE_CAMPUS_IDS,
  MACAU_RIDE_ROUTE_IDS_BY_CAMPUS,
  ACTIVITY_STATUS,
  APPLICATION_STATUS,
  MEMBER_STATUS,
  USER_GENDERS,
  PASSENGER_AVATAR_KINDS,
  MEMBER_LUGGAGE_TYPES,
  COMPANION_TIME_FLEXIBILITY,
  COMPANION_TRANSPORT_PREFERENCES,
  SPORT_LEVELS,
  SPORT_INTENSITIES,
  REPORT_REASONS
};
