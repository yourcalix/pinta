'use strict';

const PILOT_CITY = '澳门';
const PILOT_DISTRICTS = Object.freeze(['澳门校园']);

const RIDE_ROUTES = Object.freeze([
  Object.freeze({ id: 'QINGMAO_TO_TAIPA', code: '青城', originId: 'QINGMAO', origin: '青茂口岸', destinationId: 'TAIPA_CAMPUS', destination: '凼仔校区' }),
  Object.freeze({ id: 'HENGQIN_TO_TAIPA', code: '琴城', originId: 'HENGQIN', origin: '横琴口岸', destinationId: 'TAIPA_CAMPUS', destination: '凼仔校区' }),
  Object.freeze({ id: 'QINGMAO_TO_GOLDEN_DRAGON', code: '青龍', originId: 'QINGMAO', origin: '青茂口岸', destinationId: 'GOLDEN_DRAGON_CAMPUS', destination: '金龙校区' }),
  Object.freeze({ id: 'HENGQIN_TO_GOLDEN_DRAGON', code: '琴龍', originId: 'HENGQIN', origin: '横琴口岸', destinationId: 'GOLDEN_DRAGON_CAMPUS', destination: '金龙校区' }),
  Object.freeze({ id: 'TAIPA_TO_QINGMAO', code: '城青', originId: 'TAIPA_CAMPUS', origin: '凼仔校区', destinationId: 'QINGMAO', destination: '青茂口岸' }),
  Object.freeze({ id: 'TAIPA_TO_HENGQIN', code: '城琴', originId: 'TAIPA_CAMPUS', origin: '凼仔校区', destinationId: 'HENGQIN', destination: '横琴口岸' }),
  Object.freeze({ id: 'GOLDEN_DRAGON_TO_QINGMAO', code: '龍青', originId: 'GOLDEN_DRAGON_CAMPUS', origin: '金龙校区', destinationId: 'QINGMAO', destination: '青茂口岸' }),
  Object.freeze({ id: 'GOLDEN_DRAGON_TO_HENGQIN', code: '龍琴', originId: 'GOLDEN_DRAGON_CAMPUS', origin: '金龙校区', destinationId: 'HENGQIN', destination: '横琴口岸' })
]);

const RIDE_CAMPUS_OPTIONS = Object.freeze([
  Object.freeze({ id: '', label: '全部' }),
  Object.freeze({ id: 'TAIPA_CAMPUS', label: '凼仔校区' }),
  Object.freeze({ id: 'GOLDEN_DRAGON_CAMPUS', label: '金龙校区' })
]);

const RIDE_ROUTE_OPTIONS = Object.freeze([
  Object.freeze({ id: '', code: '全部', label: '全部路线' }),
  ...RIDE_ROUTES.map((route) => Object.freeze({
    ...route,
    label: `${route.code} ${route.origin}→${route.destination}`
  }))
]);

function getRideRoute(routeId) {
  return RIDE_ROUTES.find((route) => route.id === routeId) || null;
}

const RIDE_ROUTE_ORIGINS = Object.freeze(
  [...new Set(RIDE_ROUTES.map((route) => route.origin))]
);

function routesFromOrigin(origin) {
  return RIDE_ROUTES.filter((route) => route.origin === origin);
}

function rideRoutePickerState(routeId) {
  const selected = getRideRoute(routeId) || RIDE_ROUTES[0];
  const originIndex = Math.max(RIDE_ROUTE_ORIGINS.indexOf(selected.origin), 0);
  const availableRoutes = routesFromOrigin(RIDE_ROUTE_ORIGINS[originIndex]);
  const destinationIndex = Math.max(availableRoutes.findIndex((route) => route.id === selected.id), 0);
  return {
    columns: [RIDE_ROUTE_ORIGINS, availableRoutes.map((route) => route.destination)],
    indexes: [originIndex, destinationIndex],
    route: availableRoutes[destinationIndex] || availableRoutes[0]
  };
}

function rideRouteFromIndexes(indexes) {
  const originIndex = Math.min(Math.max(Number(indexes && indexes[0]) || 0, 0), RIDE_ROUTE_ORIGINS.length - 1);
  const availableRoutes = routesFromOrigin(RIDE_ROUTE_ORIGINS[originIndex]);
  const destinationIndex = Math.min(Math.max(Number(indexes && indexes[1]) || 0, 0), availableRoutes.length - 1);
  return availableRoutes[destinationIndex] || RIDE_ROUTES[0];
}

module.exports = {
  PILOT_CITY,
  PILOT_DISTRICTS,
  RIDE_ROUTES,
  RIDE_ROUTE_OPTIONS,
  RIDE_CAMPUS_OPTIONS,
  RIDE_ROUTE_ORIGINS,
  getRideRoute,
  routesFromOrigin,
  rideRoutePickerState,
  rideRouteFromIndexes
};
