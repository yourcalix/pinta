'use strict';

function driverApprovalFacts(userId, application, at) {
  const summary = application.summary;
  const vehicleId = `vehicle-${userId}`;
  return {
    driver: {
      id: userId,
      userId,
      status: 'ACTIVE',
      reviewStatus: 'APPROVED',
      approvedApplicationId: application.id,
      approvedAt: at
    },
    vehicle: {
      id: vehicleId,
      driverId: userId,
      status: 'ACTIVE',
      reviewStatus: 'APPROVED',
      type: summary.vehicleType,
      plateMasked: summary.plateMasked,
      passengerCapacity: summary.passengerCapacity,
      approvedAt: at
    }
  };
}

module.exports = { driverApprovalFacts };
