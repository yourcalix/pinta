'use strict';

const ACTIVITY_TYPES = Object.freeze(['ride', 'product', 'buddy']);
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
const RIDE_FULFILLMENT_STATUS = Object.freeze({
  UNASSIGNED: 'UNASSIGNED',
  ASSIGNED: 'ASSIGNED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED'
});
const DRIVER_REVIEW_STATUS = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED'
});
const DRIVER_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED'
});
const VEHICLE_REVIEW_STATUS = DRIVER_REVIEW_STATUS;
const VEHICLE_STATUS = DRIVER_STATUS;
const ONBOARDING_ROLE_INTENTS = Object.freeze(['PASSENGER', 'DRIVER']);
const DRIVER_APPLICATION_STATUS = Object.freeze({
  SUBMITTED: 'SUBMITTED',
  NEEDS_MORE_INFO: 'NEEDS_MORE_INFO',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
  DELETION_PENDING: 'DELETION_PENDING',
  DELETED: 'DELETED'
});
const DRIVER_IDENTITY_TYPES = Object.freeze([
  'MACAU_RESIDENT_ID',
  'HONG_KONG_ID',
  'MAINLAND_ID',
  'PASSPORT',
  'MAINLAND_TRAVEL_PERMIT'
]);
const DRIVER_DOCUMENT_KINDS = Object.freeze(['identityFront', 'driverLicense', 'vehicleExterior']);
const RIDE_MIN_PASSENGERS = 7;
const RIDE_MAX_PASSENGERS = 7;
const RIDE_PICKUP_WINDOW_MINUTES = 60;
const RIDE_PICKUP_SLOT_MINUTES = 15;
const RIDE_FEE_TYPES = Object.freeze(['FREE', 'SHARED_COST', 'NO_COST']);
const RIDE_LUGGAGE_RULES = Object.freeze(['NO_LARGE', 'ONE_SMALL', 'TRUNK_OK']);
const PRODUCT_DELIVERY_MODES = Object.freeze(['FACE_TO_FACE', 'PICKUP', 'ARRANGE_AFTER_FORMED']);
const BUDDY_COST_MODES = Object.freeze(['AA', 'SELF_PAY', 'HOST_TREATS']);
const BUDDY_LEVELS = Object.freeze(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']);
const REPORT_REASONS = Object.freeze([
  'FALSE_INFORMATION',
  'ILLEGAL_RIDE_CHARGE',
  'FRAUD_OR_DIVERSION',
  'HARASSMENT',
  'OTHER'
]);

module.exports = {
  ACTIVITY_TYPES,
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
  RIDE_FULFILLMENT_STATUS,
  DRIVER_REVIEW_STATUS,
  DRIVER_STATUS,
  VEHICLE_REVIEW_STATUS,
  VEHICLE_STATUS,
  ONBOARDING_ROLE_INTENTS,
  DRIVER_APPLICATION_STATUS,
  DRIVER_IDENTITY_TYPES,
  DRIVER_DOCUMENT_KINDS,
  RIDE_MIN_PASSENGERS,
  RIDE_MAX_PASSENGERS,
  RIDE_PICKUP_WINDOW_MINUTES,
  RIDE_PICKUP_SLOT_MINUTES,
  RIDE_FEE_TYPES,
  RIDE_LUGGAGE_RULES,
  PRODUCT_DELIVERY_MODES,
  BUDDY_COST_MODES,
  BUDDY_LEVELS,
  REPORT_REASONS
};
