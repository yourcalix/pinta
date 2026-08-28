'use strict';

const { AppError, invariant } = require('./errors');
const {
  ACTIVITY_STATUS,
  APPLICATION_STATUS,
  MEMBER_STATUS,
  RIDE_FULFILLMENT_STATUS,
  DRIVER_REVIEW_STATUS,
  DRIVER_STATUS,
  VEHICLE_REVIEW_STATUS,
  VEHICLE_STATUS,
  RIDE_PICKUP_SLOT_MINUTES,
  MACAU_RIDE_ROUTE_IDS_BY_CAMPUS
} = require('./constants');
const { stableEntityId } = require('./ids');
const { collectPublicActivityPage } = require('./public-activity-page');
const {
  rideCapacity,
  rideThreshold,
  isRidePassengerJoinable,
  isRideContactUnlocked,
  rideDriverAvailability,
  normalizeRideCapacity
} = require('./ride-policy');

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function rideFulfillmentSummary(fulfillment) {
  if (!fulfillment) return null;
  return {
    status: fulfillment.status,
    pickupAt: fulfillment.pickupAt || null,
    assignedAt: fulfillment.assignedAt || null,
    ...(fulfillment.driver ? { driver: clone(fulfillment.driver) } : {}),
    ...(fulfillment.vehicle ? { vehicle: clone(fulfillment.vehicle) } : {})
  };
}

function isRideJoinable(activity, at) {
  return isRidePassengerJoinable(normalizeRideCapacity(activity), at);
}

class MemoryStore {
  constructor(seed = {}) {
    this.users = new Map((seed.users || []).map((item) => [item.id, clone(item)]));
    this.activities = new Map((seed.activities || []).map((item) => [item.id, clone(item)]));
    this.applications = new Map((seed.applications || []).map((item) => [item.id, clone(item)]));
    this.members = new Map((seed.members || []).map((item) => [item.id, clone(item)]));
    this.notifications = new Map((seed.notifications || []).map((item) => [item.id, clone(item)]));
    this.activityQuestions = new Map((seed.activityQuestions || []).map((item) => [item.id, clone(item)]));
    this.drivers = new Map((seed.drivers || []).map((item) => [item.userId || item.id, clone(item)]));
    this.driverApplications = new Map((seed.driverApplications || []).map((item) => [item.userId || item.id, clone(item)]));
    this.driverSecrets = new Map((seed.driverSecrets || []).map((item) => [item.userId || item.id, clone(item)]));
    this.driverDocumentUploads = new Map((seed.driverDocumentUploads || []).map((item) => [item.id, clone(item)]));
    this.vehicles = new Map((seed.vehicles || []).map((item) => [item.id, clone(item)]));
    this.rideFulfillments = new Map((seed.rideFulfillments || []).map((item) => [item.activityId, clone(item)]));
    this.reports = new Map((seed.reports || []).map((item) => [item.id, clone(item)]));
    this.auditLogs = new Map((seed.auditLogs || []).map((item) => [item.id, clone(item)]));
    this.idempotency = new Map();
  }

  async ensureUser(actorId, at) {
    if (!this.users.has(actorId)) {
      this.users.set(actorId, {
        id: actorId,
        role: 'user',
        status: 'ACTIVE',
        profile: null,
        createdAt: at,
        updatedAt: at
      });
    }
    return clone(this.users.get(actorId));
  }

  async getUser(actorId) {
    return clone(this.users.get(actorId) || null);
  }

  async updateProfile(actorId, profile, at) {
    const user = this.users.get(actorId);
    invariant(user, 'UNAUTHENTICATED');
    user.profile = clone(profile);
    user.updatedAt = at;
    return clone(user);
  }

  async updateOnboardingRole(actorId, roleIntent, at) {
    const user = this.users.get(actorId);
    invariant(user, 'UNAUTHENTICATED');
    user.onboarding = { roleIntent, completedAt: at };
    user.updatedAt = at;
    return clone(user);
  }

  async getDriverApplication(userId) {
    return clone(this.driverApplications.get(userId) || null);
  }

  async registerDriverDocumentUpload(upload) {
    this.driverDocumentUploads.set(upload.id, clone(upload));
    return clone(upload);
  }

  async confirmDriverDocumentUpload({ userId, uploadId, kind, fileID, at }) {
    const upload = this.driverDocumentUploads.get(uploadId);
    invariant(upload && upload.userId === userId && upload.kind === kind && ['PREPARED', 'INSPECTED'].includes(upload.status), 'DRIVER_DOCUMENT_REQUIRED');
    invariant(Date.parse(upload.expiresAt) > Date.parse(at), 'DRIVER_DOCUMENT_REQUIRED', '上传凭据已过期');
    invariant(fileID.endsWith(`/${upload.cloudPath}`) || fileID === upload.cloudPath, 'DRIVER_DOCUMENT_REQUIRED', '文件与上传凭据不匹配');
    if (upload.status === 'INSPECTED') return clone(upload);
    Object.assign(upload, { status: 'INSPECTED', sealedFileID: `memory-sealed://${upload.id}`, inspectedAt: at, updatedAt: at });
    return clone(upload);
  }

  async resolveDriverDocumentReferences(userId, documentRefs, at) {
    return Object.fromEntries(Object.entries(documentRefs).map(([kind, reference]) => {
      const upload = this.driverDocumentUploads.get(reference.uploadId);
      invariant(upload && upload.userId === userId && upload.kind === kind && upload.status === 'INSPECTED', 'DRIVER_DOCUMENT_REQUIRED');
      invariant(Date.parse(upload.expiresAt) > Date.parse(at), 'DRIVER_DOCUMENT_REQUIRED', '上传凭据已过期');
      invariant(upload.sealedFileID, 'DRIVER_DOCUMENT_REQUIRED', '认证图片尚未完成安全处理');
      return [kind, { uploadId: upload.id, fileID: upload.sealedFileID }];
    }));
  }

  async submitDriverApplication({ userId, application, secrets, documentRefs, audit }) {
    const current = this.driverApplications.get(userId);
    if (current && current.operationKeyHash === application.operationKeyHash) {
      invariant(current.payloadHash === application.payloadHash, 'CONFLICT', '幂等键已用于其他司机认证资料');
      return clone(current);
    }
    invariant(!current || !['SUBMITTED', 'APPROVED'].includes(current.status), current && current.status === 'SUBMITTED' ? 'DRIVER_APPLICATION_PENDING' : 'DRIVER_APPLICATION_LOCKED');
    Object.entries(documentRefs).forEach(([kind, reference]) => {
      const upload = this.driverDocumentUploads.get(reference.uploadId);
      invariant(upload && upload.userId === userId && upload.kind === kind && upload.status === 'INSPECTED', 'DRIVER_DOCUMENT_REQUIRED');
      invariant(Date.parse(upload.expiresAt) > Date.parse(application.updatedAt), 'DRIVER_DOCUMENT_REQUIRED', '上传凭据已过期');
      invariant(reference.fileID === upload.sealedFileID, 'DRIVER_DOCUMENT_REQUIRED', '文件与上传凭据不匹配');
      upload.status = 'BOUND';
      upload.applicationRevision = application.revision;
      upload.fileIDHash = application.documentFileHashes[kind];
      upload.updatedAt = application.updatedAt;
    });
    this.driverApplications.set(userId, clone(application));
    this.driverSecrets.set(userId, clone({ id: userId, userId, ...secrets, status: 'ACTIVE', retentionUntil: null, updatedAt: application.updatedAt }));
    if (audit) this.auditLogs.set(audit.id, clone(audit));
    return clone(application);
  }

  async withdrawDriverApplication(userId, at, audit) {
    const application = this.driverApplications.get(userId);
    invariant(application, 'NOT_FOUND');
    invariant(['SUBMITTED', 'NEEDS_MORE_INFO'].includes(application.status), 'DRIVER_APPLICATION_LOCKED');
    application.status = 'WITHDRAWN';
    application.updatedAt = at;
    const secret = this.driverSecrets.get(userId);
    if (secret) Object.assign(secret, { status: 'RETENTION_PENDING', retentionUntil: new Date(Date.parse(at) + 30 * 24 * 60 * 60 * 1000).toISOString(), updatedAt: at });
    this.driverDocumentUploads.forEach((upload) => {
      if (upload.userId === userId && upload.status === 'BOUND') Object.assign(upload, { status: 'RETENTION_PENDING', retentionUntil: new Date(Date.parse(at) + 30 * 24 * 60 * 60 * 1000).toISOString(), updatedAt: at });
    });
    if (audit) this.auditLogs.set(audit.id, clone(audit));
    return clone(application);
  }

  async reviewDriverApplication({ userId, reviewerId, decision, reasonCode, reviewPayloadHash, at, audit }) {
    const application = this.driverApplications.get(userId);
    if (application && application.reviewOperationKeyHash === audit.operationKeyHash) {
      invariant(application.reviewPayloadHash === reviewPayloadHash, 'CONFLICT', '幂等键已用于其他审核决定');
      return clone(application);
    }
    invariant(application && ['SUBMITTED', 'NEEDS_MORE_INFO'].includes(application.status), 'DRIVER_APPLICATION_LOCKED');
    application.status = decision;
    application.review = { reviewerId, reasonCode: reasonCode || '', reviewedAt: at };
    application.updatedAt = at;
    application.reviewOperationKeyHash = audit.operationKeyHash;
    application.reviewPayloadHash = reviewPayloadHash;
    if (decision === 'APPROVED') {
      this.drivers.set(userId, { id: userId, userId, status: 'ACTIVE', reviewStatus: 'APPROVED', approvedApplicationId: application.id, approvedAt: at });
      const summary = application.summary;
      const vehicleId = `vehicle-${userId}`;
      this.vehicles.set(vehicleId, {
        id: vehicleId,
        driverId: userId,
        status: 'ACTIVE',
        reviewStatus: 'APPROVED',
        type: summary.vehicleType,
        plateMasked: summary.plateMasked,
        passengerCapacity: summary.passengerCapacity,
        approvedAt: at
      });
    }
    if (['REJECTED', 'NEEDS_MORE_INFO'].includes(decision)) {
      const secret = this.driverSecrets.get(userId);
      if (secret) Object.assign(secret, { status: 'RETENTION_PENDING', retentionUntil: new Date(Date.parse(at) + 30 * 24 * 60 * 60 * 1000).toISOString(), updatedAt: at });
      this.driverDocumentUploads.forEach((upload) => {
        if (upload.userId === userId && upload.status === 'BOUND') Object.assign(upload, { status: 'RETENTION_PENDING', retentionUntil: new Date(Date.parse(at) + 30 * 24 * 60 * 60 * 1000).toISOString(), updatedAt: at });
      });
    }
    if (audit) this.auditLogs.set(audit.id, clone(audit));
    return clone(application);
  }

  async createActivityWithOwner(activity, ownerMember, rideFulfillment = null) {
    const existing = this.activities.get(activity.id);
    if (existing) {
      invariant(existing.operationKeyHash === activity.operationKeyHash, 'CONFLICT', '幂等键已用于其他活动');
      return clone(existing);
    }
    this.activities.set(activity.id, clone(activity));
    this.members.set(ownerMember.id, clone(ownerMember));
    if (rideFulfillment) this.rideFulfillments.set(activity.id, clone(rideFulfillment));
    return clone(activity);
  }

  async getActivity(activityId) {
    const activity = this.activities.get(activityId);
    if (!activity) return null;
    if (activity.type !== 'ride') return clone(activity);
    return clone({
      ...activity,
      rideFulfillment: rideFulfillmentSummary(this.rideFulfillments.get(activityId))
    });
  }

  async listActivities(filters = {}, at) {
    const allowedPublicStatuses = filters.status
      ? [filters.status]
      : [ACTIVITY_STATUS.RECRUITING, ACTIVITY_STATUS.FORMED];
    let candidates = [...this.activities.values()]
      .filter((activity) => allowedPublicStatuses.includes(activity.status))
      .map((activity) => activity.type === 'ride'
        ? {
            ...activity,
            rideFulfillment: rideFulfillmentSummary(this.rideFulfillments.get(activity.id))
          }
        : activity);
    if (filters.type) candidates = candidates.filter((activity) => activity.type === filters.type);
    if (filters.city) candidates = candidates.filter((activity) => activity.city === filters.city);
    if (filters.district) candidates = candidates.filter((activity) => activity.district === filters.district);
    if (filters.routeId) candidates = candidates.filter(
      (activity) => activity.type === 'ride' && activity.typeData && activity.typeData.routeId === filters.routeId
    );
    if (filters.campusId) {
      const campusRouteIds = MACAU_RIDE_ROUTE_IDS_BY_CAMPUS[filters.campusId] || [];
      candidates = candidates.filter(
        (activity) => activity.type === 'ride' && activity.typeData && campusRouteIds.includes(activity.typeData.routeId)
      );
    }
    candidates.sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
    const page = await collectPublicActivityPage({
      offset: filters.cursor || 0,
      limit: filters.limit,
      keyword: filters.keyword,
      at,
      filterActivity: (activity) => filters.viewMode === 'driver'
        ? rideDriverAvailability(activity, at).acceptable
        : activity.type !== 'ride' || isRideJoinable(activity, at),
      fetchBatch: async (offset, size) => candidates.slice(offset, offset + size)
    });
    return { items: clone(page.items), nextCursor: page.nextCursor };
  }

  async getViewerContext(activityId, actorId) {
    const activity = this.activities.get(activityId);
    if (!activity) return {};
    const application = [...this.applications.values()]
      .filter((item) => item.activityId === activityId && item.applicantId === actorId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    const member = [...this.members.values()].find(
      (item) => item.activityId === activityId && item.userId === actorId && item.status === MEMBER_STATUS.ACTIVE
    );
    return clone({
      application,
      member,
      role: activity.ownerId === actorId ? 'owner' : member ? 'member' : application ? 'applicant' : 'guest'
    });
  }

  async listUserActivities(actorId, at) {
    const effectiveAt = at || new Date().toISOString();
    const hydrate = (activity) => {
      if (!activity || activity.type !== 'ride') return activity;
      const effectiveActivity = {
        ...activity,
        rideFulfillment: rideFulfillmentSummary(this.rideFulfillments.get(activity.id))
      };
      return { ...effectiveActivity, rideJoinable: isRideJoinable(effectiveActivity, effectiveAt) };
    };
    const owned = [...this.activities.values()].filter((item) => item.ownerId === actorId).map(hydrate);
    const joinedIds = new Set(
      [...this.members.values()]
        .filter((item) => item.userId === actorId && item.role !== 'OWNER' && item.status === MEMBER_STATUS.ACTIVE)
        .map((item) => item.activityId)
    );
    const joined = [...joinedIds].map((id) => hydrate(this.activities.get(id))).filter(Boolean);
    return clone({ owned, joined });
  }

  async listActivityQuestions(activityId, options = {}) {
    const cursor = Number(options.cursor) || 0;
    const limit = Math.min(Math.max(Number(options.limit) || 10, 1), 10);
    const items = [...this.activityQuestions.values()]
      .filter((item) => item.activityId === activityId)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    const page = items.slice(cursor, cursor + limit + 1);
    return clone({
      items: page.slice(0, limit),
      nextCursor: page.length > limit ? String(cursor + limit) : null
    });
  }

  async createActivityQuestion(question, audit) {
    const activity = this.activities.get(question.activityId);
    invariant(activity, 'NOT_FOUND');
    invariant(activity.status !== ACTIVITY_STATUS.SUSPENDED, 'TAKEDOWN');
    invariant(
      [ACTIVITY_STATUS.RECRUITING, ACTIVITY_STATUS.FORMED].includes(activity.status),
      'CONFLICT',
      '该活动当前不能提问'
    );
    invariant(
      activity.status !== ACTIVITY_STATUS.RECRUITING
        || Date.parse(activity.deadlineAt) > Date.parse(question.createdAt),
      'CONFLICT',
      '该活动当前不能提问'
    );
    const existing = this.activityQuestions.get(question.id);
    if (existing) {
      invariant(existing.submissionKeyHash === question.submissionKeyHash, 'CONFLICT', '幂等键已用于其他问题');
      if (audit) this.auditLogs.set(audit.id, clone(audit));
      return clone(existing);
    }
    this.activityQuestions.set(question.id, clone(question));
    if (audit) this.auditLogs.set(audit.id, clone(audit));
    return clone(question);
  }

  async answerActivityQuestionAtomic({ activityId, questionId, ownerId, answer, audit, at }) {
    const activity = this.activities.get(activityId);
    const question = this.activityQuestions.get(questionId);
    invariant(activity && question && question.activityId === activityId, 'NOT_FOUND');
    invariant(activity.status !== ACTIVITY_STATUS.SUSPENDED, 'TAKEDOWN');
    invariant(activity.ownerId === ownerId, 'FORBIDDEN');
    invariant(
      [ACTIVITY_STATUS.RECRUITING, ACTIVITY_STATUS.FORMED, ACTIVITY_STATUS.IN_PROGRESS].includes(activity.status),
      'CONFLICT',
      '该活动当前不能回答问题'
    );
    if (question.answer) {
      if (question.answer.operationKeyHash === answer.operationKeyHash) {
        if (audit) this.auditLogs.set(audit.id, clone(audit));
        return clone(question);
      }
      throw new AppError('CONFLICT', '该问题已经回答');
    }
    question.answer = clone(answer);
    question.updatedAt = at;
    if (audit) this.auditLogs.set(audit.id, clone(audit));
    return clone(question);
  }

  async createApplication(application) {
    const activity = this.activities.get(application.activityId);
    invariant(activity, 'NOT_FOUND');
    const effectiveActivity = activity.type === 'ride'
      ? { ...activity, rideFulfillment: rideFulfillmentSummary(this.rideFulfillments.get(activity.id)) }
      : activity;
    invariant(
      activity.type === 'ride'
        ? isRideJoinable(effectiveActivity, application.createdAt)
        : activity.status === ACTIVITY_STATUS.RECRUITING,
      'CONFLICT',
      '该活动当前不可申请'
    );
    if (effectiveActivity.memberCount >= (effectiveActivity.type === 'ride'
      ? rideCapacity(effectiveActivity)
      : (effectiveActivity.maxPassengers || effectiveActivity.targetMembers))) {
      throw new AppError('CAPACITY_FULL');
    }
    invariant(effectiveActivity.ownerId !== application.applicantId, 'CONFLICT', '不能申请自己发布的活动');
    invariant(Date.parse(effectiveActivity.deadlineAt) > Date.parse(application.createdAt), 'CONFLICT', '该活动报名已截止');
    const duplicate = this.applications.get(application.id);
    if (duplicate && duplicate.submissionKeyHash === application.submissionKeyHash) return clone(duplicate);
    invariant(
      !duplicate || ![APPLICATION_STATUS.PENDING, APPLICATION_STATUS.APPROVED].includes(duplicate.status),
      'CONFLICT',
      '你已经申请或加入该活动'
    );
    const activeMember = [...this.members.values()].find(
      (item) => item.activityId === application.activityId
        && item.userId === application.applicantId
        && item.status === MEMBER_STATUS.ACTIVE
    );
    invariant(!activeMember, 'CONFLICT', '你已经是该活动成员');
    this.applications.set(application.id, clone(application));
    return clone(application);
  }

  async approveApplicationAtomic({ activityId, applicationId, ownerId, at }) {
    const activity = this.activities.get(activityId);
    const application = this.applications.get(applicationId);
    invariant(activity && application && application.activityId === activityId, 'NOT_FOUND');
    invariant(activity.ownerId === ownerId, 'FORBIDDEN');
    const effectiveActivity = activity.type === 'ride'
      ? { ...activity, rideFulfillment: rideFulfillmentSummary(this.rideFulfillments.get(activityId)) }
      : activity;

    if (application.status === APPLICATION_STATUS.APPROVED) {
      const existingMember = [...this.members.values()].find(
        (item) => item.activityId === activityId && item.userId === application.applicantId && item.status === MEMBER_STATUS.ACTIVE
      );
      return clone({ activity: effectiveActivity, application, member: existingMember, cancelledApplicantIds: [] });
    }

    invariant(Date.parse(activity.deadlineAt) > Date.parse(at), 'CONFLICT', '该活动报名已截止');
    if (activity.type === 'ride' && activity.status === ACTIVITY_STATUS.FORMED) {
      invariant(
        Date.parse(activity.typeData && activity.typeData.pickupWindowEnd) > Date.parse(at),
        'CONFLICT',
        '该行程接车时间窗已结束'
      );
    }

    invariant(
      activity.type === 'ride'
        ? isRideJoinable(effectiveActivity, at)
        : activity.status === ACTIVITY_STATUS.RECRUITING,
      'CONFLICT',
      '活动当前不可继续批准成员'
    );
    invariant(application.status === APPLICATION_STATUS.PENDING, 'CONFLICT', '该申请已处理');
    const capacity = activity.type === 'ride'
      ? rideCapacity(activity)
      : (activity.maxPassengers || activity.targetMembers);
    if (activity.memberCount >= capacity) throw new AppError('CAPACITY_FULL');

    const duplicateMember = [...this.members.values()].find(
      (item) => item.activityId === activityId && item.userId === application.applicantId && item.status === MEMBER_STATUS.ACTIVE
    );
    invariant(!duplicateMember, 'CONFLICT', '申请人已经是活动成员');

    application.status = APPLICATION_STATUS.APPROVED;
    application.approvedAt = at;
    application.updatedAt = at;
    const member = {
      id: stableEntityId('member', activityId, application.applicantId),
      activityId,
      userId: application.applicantId,
      role: 'MEMBER',
      status: MEMBER_STATUS.ACTIVE,
      joinedAt: at
    };
    this.members.set(member.id, member);
    activity.memberCount += 1;
    if (activity.type === 'ride') activity.rideFulfillment = effectiveActivity.rideFulfillment;
    activity.version += 1;
    activity.updatedAt = at;

    const cancelledApplicantIds = [];
    const threshold = activity.type === 'ride'
      ? rideThreshold(activity)
      : (activity.minPassengers || activity.targetMembers);
    if (activity.memberCount >= threshold) {
      activity.status = ACTIVITY_STATUS.FORMED;
      activity.formedAt = activity.formedAt || at;
    }
    if (activity.memberCount >= capacity) {
      for (const item of this.applications.values()) {
        if (item.activityId === activityId && item.status === APPLICATION_STATUS.PENDING) {
          item.status = APPLICATION_STATUS.CANCELLED_BY_ACTIVITY;
          item.updatedAt = at;
          cancelledApplicantIds.push(item.applicantId);
        }
      }
    }
    if (activity.type === 'ride') activity.rideJoinable = isRideJoinable(activity, at);
    return clone({ activity, application, member, cancelledApplicantIds });
  }

  async rejectApplication(applicationId, ownerId, at) {
    const application = this.applications.get(applicationId);
    invariant(application, 'NOT_FOUND');
    const activity = this.activities.get(application.activityId);
    invariant(activity && activity.ownerId === ownerId, 'FORBIDDEN');
    if (application.status === APPLICATION_STATUS.REJECTED) return clone({ activity, application });
    invariant(application.status === APPLICATION_STATUS.PENDING, 'CONFLICT', '该申请已处理');
    application.status = APPLICATION_STATUS.REJECTED;
    application.updatedAt = at;
    return clone({ activity, application });
  }

  async withdrawApplication(applicationId, actorId, at) {
    const application = this.applications.get(applicationId);
    invariant(application, 'NOT_FOUND');
    invariant(application.applicantId === actorId, 'FORBIDDEN');
    if (application.status === APPLICATION_STATUS.WITHDRAWN) return clone(application);
    invariant(application.status === APPLICATION_STATUS.PENDING, 'CONFLICT', '当前状态不能撤回申请');
    application.status = APPLICATION_STATUS.WITHDRAWN;
    application.updatedAt = at;
    return clone(application);
  }

  async leaveActivity(activityId, actorId, reason, at) {
    const activity = this.activities.get(activityId);
    invariant(activity, 'NOT_FOUND');
    const effectiveActivity = activity.type === 'ride'
      ? { ...activity, rideFulfillment: rideFulfillmentSummary(this.rideFulfillments.get(activityId)) }
      : activity;
    invariant(
      activity.type !== 'ride'
        || !effectiveActivity.rideFulfillment
        || effectiveActivity.rideFulfillment.status === RIDE_FULFILLMENT_STATUS.UNASSIGNED,
      'CONFLICT',
      '司机已确认后暂不可退团，请联系发起者处理'
    );
    invariant(activity.ownerId !== actorId, 'FORBIDDEN', '发起者不能退团，请取消活动');
    const member = [...this.members.values()].find(
      (item) => item.activityId === activityId && item.userId === actorId && item.status === MEMBER_STATUS.ACTIVE
    );
    if (!member) {
      const leftMember = [...this.members.values()].find(
        (item) => item.activityId === activityId && item.userId === actorId && item.status === MEMBER_STATUS.LEFT
      );
      invariant(leftMember, 'NOT_FOUND', '你不是该活动的有效成员');
      return clone({ activity: effectiveActivity, member: leftMember });
    }
    invariant([ACTIVITY_STATUS.RECRUITING, ACTIVITY_STATUS.FORMED].includes(activity.status), 'CONFLICT', '活动当前不能退团');
    member.status = MEMBER_STATUS.LEFT;
    member.leftAt = at;
    member.leaveReason = reason;
    activity.memberCount = Math.max(1, activity.memberCount - 1);
    activity.version += 1;
    activity.updatedAt = at;
    const threshold = activity.type === 'ride'
      ? rideThreshold(activity)
      : (activity.minPassengers || activity.targetMembers);
    if (activity.status === ACTIVITY_STATUS.FORMED && activity.memberCount < threshold) {
      activity.status = ACTIVITY_STATUS.RECRUITING;
      delete activity.formedAt;
    }
    if (activity.type === 'ride') {
      activity.rideFulfillment = effectiveActivity.rideFulfillment;
      activity.rideJoinable = isRideJoinable(activity, at);
    }
    for (const item of this.applications.values()) {
      if (item.activityId === activityId && item.applicantId === actorId && item.status === APPLICATION_STATUS.APPROVED) {
        item.status = APPLICATION_STATUS.LEFT;
        item.updatedAt = at;
      }
    }
    return clone({ activity, member });
  }

  async cancelActivity(activityId, ownerId, reason, at) {
    const activity = this.activities.get(activityId);
    invariant(activity, 'NOT_FOUND');
    invariant(activity.ownerId === ownerId, 'FORBIDDEN');
    if (activity.status === ACTIVITY_STATUS.CANCELLED) {
      for (const item of this.applications.values()) {
        if (item.activityId === activityId && item.status === APPLICATION_STATUS.PENDING) {
          item.status = APPLICATION_STATUS.CANCELLED_BY_ACTIVITY;
          item.updatedAt = at;
        }
      }
      return clone({ activity });
    }
    invariant([ACTIVITY_STATUS.RECRUITING, ACTIVITY_STATUS.FORMED].includes(activity.status), 'CONFLICT', '当前状态不能取消活动');
    activity.status = ACTIVITY_STATUS.CANCELLED;
    if (activity.type === 'ride') activity.rideJoinable = false;
    activity.cancelReason = reason;
    activity.cancelledAt = at;
    activity.updatedAt = at;
    activity.version += 1;
    for (const item of this.applications.values()) {
      if (item.activityId === activityId && item.status === APPLICATION_STATUS.PENDING) {
        item.status = APPLICATION_STATUS.CANCELLED_BY_ACTIVITY;
        item.updatedAt = at;
      }
    }
    return clone({ activity });
  }

  async completeActivity(activityId, ownerId, at) {
    const activity = this.activities.get(activityId);
    invariant(activity, 'NOT_FOUND');
    invariant(activity.ownerId === ownerId, 'FORBIDDEN');
    if (activity.status === ACTIVITY_STATUS.COMPLETED) return clone(activity);
    invariant([ACTIVITY_STATUS.FORMED, ACTIVITY_STATUS.IN_PROGRESS].includes(activity.status), 'CONFLICT', '当前状态不能完成活动');
    activity.status = ACTIVITY_STATUS.COMPLETED;
    if (activity.type === 'ride') activity.rideJoinable = false;
    activity.completedAt = at;
    activity.updatedAt = at;
    activity.version += 1;
    return clone(activity);
  }

  async getGroupContact(activityId, actorId) {
    const activity = this.activities.get(activityId);
    invariant(activity, 'NOT_FOUND');
    invariant([ACTIVITY_STATUS.FORMED, ACTIVITY_STATUS.IN_PROGRESS, ACTIVITY_STATUS.COMPLETED].includes(activity.status), 'CONFLICT', '活动成团后才能查看联系信息');
    const member = [...this.members.values()].find(
      (item) => item.activityId === activityId && item.userId === actorId && item.status === MEMBER_STATUS.ACTIVE
    );
    invariant(member, 'FORBIDDEN');
    const activeMemberCount = [...this.members.values()].filter(
      (item) => item.activityId === activityId && item.status === MEMBER_STATUS.ACTIVE
    ).length;
    invariant(
      isRideContactUnlocked(activity, activeMemberCount),
      'CONFLICT',
      '拼车满7名有效乘客后才能查看联系信息'
    );
    return clone({
      activityId,
      contactInfo: activity.contactInfo,
      meeting: {
        city: activity.city,
        district: activity.district,
        placeLabel: activity.placeLabel,
        note: activity.rules || ''
      }
    });
  }

  async getDriver(userId) {
    return clone(this.drivers.get(userId) || null);
  }

  async getVehicle(vehicleId) {
    return clone(this.vehicles.get(vehicleId) || null);
  }

  async listVehiclesForDriver(driverId) {
    return clone([...this.vehicles.values()].filter((vehicle) => vehicle.driverId === driverId));
  }

  async getRideFulfillment(activityId) {
    return clone(this.rideFulfillments.get(activityId) || null);
  }

  async acceptRideAtomic({ activityId, driverId, vehicleId, pickupAt, operationKeyHash, at }) {
    const activity = this.activities.get(activityId);
    const driver = this.drivers.get(driverId);
    const vehicle = this.vehicles.get(vehicleId);
    const fulfillment = this.rideFulfillments.get(activityId);
    invariant(activity && activity.type === 'ride' && fulfillment, 'NOT_FOUND');
    invariant([ACTIVITY_STATUS.RECRUITING, ACTIVITY_STATUS.FORMED].includes(activity.status), 'CONFLICT', '当前行程暂不可承接');
    invariant(driver && driver.status === DRIVER_STATUS.ACTIVE && driver.reviewStatus === DRIVER_REVIEW_STATUS.APPROVED, 'DRIVER_NOT_APPROVED');
    invariant(vehicle && vehicle.driverId === driverId && vehicle.status === VEHICLE_STATUS.ACTIVE && vehicle.reviewStatus === VEHICLE_REVIEW_STATUS.APPROVED, 'VEHICLE_NOT_APPROVED');
    invariant(Number(vehicle.passengerCapacity) >= rideCapacity(activity), 'VEHICLE_NOT_APPROVED', '车辆核定乘客容量不足');
    if (fulfillment.status !== RIDE_FULFILLMENT_STATUS.UNASSIGNED) {
      if (fulfillment.operationKeyHash === operationKeyHash) return clone({ activity, fulfillment });
      throw new AppError('RIDE_ALREADY_ASSIGNED');
    }
    const pickupTime = Date.parse(pickupAt);
    const windowStart = Date.parse(activity.startsAt);
    const windowEnd = Date.parse(activity.typeData && activity.typeData.pickupWindowEnd);
    const now = Date.parse(at);
    invariant(Number.isFinite(now), 'INTERNAL', '服务时间不可用');
    if (Number.isFinite(windowEnd) && windowEnd <= now) throw new AppError('PICKUP_TIME_EXPIRED');
    invariant(
      Number.isFinite(pickupTime)
        && windowEnd - windowStart === 60 * 60 * 1000
        && pickupTime >= windowStart
        && pickupTime < windowEnd
        && (pickupTime - windowStart) % (RIDE_PICKUP_SLOT_MINUTES * 60 * 1000) === 0,
      'INVALID_PICKUP_SLOT'
    );
    if (pickupTime <= now) throw new AppError('PICKUP_TIME_EXPIRED');
    const user = this.users.get(driverId);
    const nextFulfillment = {
      ...fulfillment,
      status: RIDE_FULFILLMENT_STATUS.ASSIGNED,
      driverId,
      vehicleId,
      pickupAt,
      driver: { nickname: user && user.profile ? user.profile.nickname : '认证司机' },
      vehicle: { type: vehicle.type, plateMasked: vehicle.plateMasked },
      operationKeyHash,
      assignedAt: at,
      updatedAt: at,
      version: Number(fulfillment.version || 1) + 1
    };
    this.rideFulfillments.set(activityId, nextFulfillment);
    activity.rideFulfillment = {
      status: nextFulfillment.status,
      pickupAt,
      driver: clone(nextFulfillment.driver),
      vehicle: clone(nextFulfillment.vehicle)
    };
    Object.assign(activity, normalizeRideCapacity(activity));
    activity.rideJoinable = isRideJoinable(activity, at);
    activity.updatedAt = at;
    activity.version += 1;
    return clone({ activity, fulfillment: nextFulfillment });
  }

  async cancelRideAssignmentAtomic({ activityId, driverId, reason, at }) {
    const activity = this.activities.get(activityId);
    const fulfillment = this.rideFulfillments.get(activityId);
    invariant(activity && fulfillment, 'NOT_FOUND');
    invariant(fulfillment.status === RIDE_FULFILLMENT_STATUS.ASSIGNED, 'CONFLICT', '当前行程没有可取消的接送确认');
    invariant(fulfillment.driverId === driverId, 'FORBIDDEN');
    const nextFulfillment = {
      id: fulfillment.id,
      activityId,
      status: RIDE_FULFILLMENT_STATUS.UNASSIGNED,
      lastCancellation: { driverId, reason, at },
      createdAt: fulfillment.createdAt,
      updatedAt: at,
      version: Number(fulfillment.version || 1) + 1
    };
    this.rideFulfillments.set(activityId, nextFulfillment);
    activity.rideFulfillment = { status: RIDE_FULFILLMENT_STATUS.UNASSIGNED };
    activity.rideJoinable = isRideJoinable(activity, at);
    activity.updatedAt = at;
    activity.version += 1;
    return clone({ activity, fulfillment: nextFulfillment });
  }

  async listDriverRides(driverId) {
    const items = [...this.rideFulfillments.values()]
      .filter((item) => item.driverId === driverId && item.status !== RIDE_FULFILLMENT_STATUS.UNASSIGNED)
      .map((item) => ({ activity: this.activities.get(item.activityId), fulfillment: item }))
      .filter((item) => item.activity);
    return clone(items);
  }

  async listApplicationsForOwner(activityId, ownerId) {
    const activity = this.activities.get(activityId);
    invariant(activity, 'NOT_FOUND');
    invariant(activity.ownerId === ownerId, 'FORBIDDEN');
    return clone(
      [...this.applications.values()]
        .filter((item) => item.activityId === activityId)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    );
  }

  async addNotification(notification) {
    this.notifications.set(notification.id, clone(notification));
    return clone(notification);
  }

  async listNotifications(userId) {
    return clone(
      [...this.notifications.values()]
        .filter((item) => item.userId === userId)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    );
  }

  async markNotificationRead(notificationId, userId, at) {
    const notification = this.notifications.get(notificationId);
    invariant(notification, 'NOT_FOUND');
    invariant(notification.userId === userId, 'FORBIDDEN');
    notification.read = true;
    notification.readAt = at;
    return clone(notification);
  }

  async createReport(report) {
    const existing = this.reports.get(report.id);
    if (existing && existing.submissionKeyHash === report.submissionKeyHash) return clone(existing);
    invariant(!existing || existing.status === 'CLOSED', 'CONFLICT', '你已经举报过该内容');
    this.reports.set(report.id, clone(report));
    return clone(report);
  }

  async suspendActivity(activityId, adminId, reason, at) {
    const activity = this.activities.get(activityId);
    invariant(activity, 'NOT_FOUND');
    if (activity.status === ACTIVITY_STATUS.SUSPENDED) return clone(activity);
    activity.status = ACTIVITY_STATUS.SUSPENDED;
    if (activity.type === 'ride') activity.rideJoinable = false;
    activity.suspension = { adminId, reason, at };
    activity.updatedAt = at;
    activity.version += 1;
    return clone(activity);
  }

  async addAudit(audit) {
    this.auditLogs.set(audit.id, clone(audit));
    return clone(audit);
  }

  idempotencyKey(actorId, action, key) {
    return `${actorId}:${action}:${key}`;
  }

  async getIdempotency(actorId, action, key) {
    return clone(this.idempotency.get(this.idempotencyKey(actorId, action, key)) || null);
  }

  async saveIdempotency(actorId, action, key, result, at) {
    this.idempotency.set(this.idempotencyKey(actorId, action, key), clone(result));
    return { savedAt: at };
  }
}

module.exports = {
  MemoryStore
};
