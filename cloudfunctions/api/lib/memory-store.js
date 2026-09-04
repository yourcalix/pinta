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
  MEMBER_LUGGAGE_TYPES,
  PASSENGER_AVATAR_KINDS,
  MACAU_RIDE_ROUTE_IDS_BY_CAMPUS
} = require('./constants');
const { stableEntityId } = require('./ids');
const {
  COMMUNITY_POST_STATUS,
  COMMUNITY_REPLY_STATUS,
  encodeCursor,
  compareDescending,
  compareAscending,
  isAfterDescendingCursor,
  isAfterAscendingCursor
} = require('./community');
const {
  encodeDirectCursor,
  compareDirectDescending,
  isAfterDirectCursor
} = require('./direct-message');
const { collectPublicActivityPage } = require('./public-activity-page');
const { driverApprovalFacts } = require('./driver-approval');
const {
  rideCapacity,
  rideThreshold,
  isRidePassengerJoinable,
  isRideContactUnlocked,
  rideDriverAvailability,
  normalizeRideCapacity
} = require('./ride-policy');
const {
  upsertAvatarRoster,
  removeAvatarRosterMember
} = require('./passenger-avatar');

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
    this.memberContacts = new Map((seed.memberContacts || []).map((item) => [item.id, clone(item)]));
    this.notifications = new Map((seed.notifications || []).map((item) => [item.id, clone(item)]));
    this.activityQuestions = new Map((seed.activityQuestions || []).map((item) => [item.id, clone(item)]));
    this.communityPosts = new Map((seed.communityPosts || []).map((item) => [item.id, clone(item)]));
    this.communityReplies = new Map((seed.communityReplies || []).map((item) => [item.id, clone(item)]));
    this.directConversations = new Map((seed.directConversations || []).map((item) => [item.id, clone(item)]));
    this.directMessages = new Map((seed.directMessages || []).map((item) => [item.id, clone(item)]));
    this.drivers = new Map((seed.drivers || []).map((item) => [item.userId || item.id, clone(item)]));
    this.driverApplications = new Map((seed.driverApplications || []).map((item) => [item.userId || item.id, clone(item)]));
    this.driverSecrets = new Map((seed.driverSecrets || []).map((item) => [item.userId || item.id, clone(item)]));
    this.driverDocumentUploads = new Map((seed.driverDocumentUploads || []).map((item) => [item.id, clone(item)]));
    this.vehicles = new Map((seed.vehicles || []).map((item) => [item.id, clone(item)]));
    this.rideFulfillments = new Map((seed.rideFulfillments || []).map((item) => [item.activityId, clone(item)]));
    this.reports = new Map((seed.reports || []).map((item) => [item.id, clone(item)]));
    this.auditLogs = new Map((seed.auditLogs || []).map((item) => [item.id, clone(item)]));
    this.idempotency = new Map();
    this.communityRateLimits = new Map();
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

  async syncUserAvatarKind(actorId, avatarKind, at) {
    invariant(PASSENGER_AVATAR_KINDS.includes(avatarKind), 'VALIDATION_ERROR', '头像类型无效');
    for (const member of this.members.values()) {
      if (member.userId !== actorId || member.status !== MEMBER_STATUS.ACTIVE) continue;
      const activity = this.activities.get(member.activityId);
      if (activity && activity.type === 'ride' && [ACTIVITY_STATUS.RECRUITING, ACTIVITY_STATUS.FORMED, ACTIVITY_STATUS.IN_PROGRESS].includes(activity.status)) {
        member.avatarKind = avatarKind;
        member.updatedAt = at;
        activity.avatarRoster = upsertAvatarRoster(activity.avatarRoster, member.id, avatarKind);
        activity.updatedAt = at;
      }
    }
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

  async submitDriverApplication({ userId, application, secrets, documentRefs, autoApprove, audit }) {
    const current = this.driverApplications.get(userId);
    if (current && current.operationKeyHash === application.operationKeyHash) {
      invariant(current.payloadHash === application.payloadHash, 'CONFLICT', '幂等键已用于其他司机认证资料');
      if (autoApprove && current.status === 'APPROVED') {
        const facts = driverApprovalFacts(userId, current, current.updatedAt);
        this.drivers.set(userId, clone(facts.driver));
        this.vehicles.set(facts.vehicle.id, clone(facts.vehicle));
      }
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
    if (autoApprove) {
      const facts = driverApprovalFacts(userId, application, application.updatedAt);
      this.drivers.set(userId, clone(facts.driver));
      this.vehicles.set(facts.vehicle.id, clone(facts.vehicle));
    }
    if (audit) this.auditLogs.set(audit.id, clone(audit));
    return clone(application);
  }

  async ensureApprovedDriverFacts(userId, application, at) {
    invariant(application && application.status === 'APPROVED', 'DRIVER_APPLICATION_LOCKED');
    const facts = driverApprovalFacts(userId, application, at);
    this.drivers.set(userId, clone(facts.driver));
    this.vehicles.set(facts.vehicle.id, clone(facts.vehicle));
    return clone(facts);
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
      const facts = driverApprovalFacts(userId, application, at);
      this.drivers.set(userId, clone(facts.driver));
      this.vehicles.set(facts.vehicle.id, clone(facts.vehicle));
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

  async createActivityWithOwner(activity, ownerMember, rideFulfillment = null, ownerContact = null) {
    if (activity.type === 'ride') {
      invariant(MEMBER_LUGGAGE_TYPES.includes(ownerMember.luggageType), 'VALIDATION_ERROR', '我的行李选项无效');
    }
    const existing = this.activities.get(activity.id);
    if (existing) {
      invariant(existing.operationKeyHash === activity.operationKeyHash, 'CONFLICT', '幂等键已用于其他活动');
      return clone(existing);
    }
    this.activities.set(activity.id, clone(activity));
    this.members.set(ownerMember.id, clone(ownerMember));
    if (ownerContact) this.memberContacts.set(ownerContact.id, clone(ownerContact));
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
    const fulfillment = activity.type === 'ride' ? this.rideFulfillments.get(activityId) : null;
    return clone({
      application,
      member,
      role: activity.ownerId === actorId
        ? 'owner'
        : member
          ? 'member'
          : fulfillment && fulfillment.status === RIDE_FULFILLMENT_STATUS.ASSIGNED && fulfillment.driverId === actorId
            ? 'driver'
            : application ? 'applicant' : 'guest'
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

  async listCommunityPosts({ cursor, limit }) {
    const candidates = [...this.communityPosts.values()]
      .filter((item) => item.status === COMMUNITY_POST_STATUS.ACTIVE && isAfterDescendingCursor(item, cursor))
      .sort(compareDescending);
    const page = candidates.slice(0, limit + 1);
    return clone({ items: page.slice(0, limit), nextCursor: page.length > limit ? encodeCursor(page[limit - 1]) : null });
  }

  async getCommunityPost(postId) {
    return clone(this.communityPosts.get(postId) || null);
  }

  async listCommunityReplies(postId, { cursor, limit }) {
    const candidates = [...this.communityReplies.values()]
      .filter((item) => item.postId === postId && item.status === COMMUNITY_REPLY_STATUS.ACTIVE && isAfterAscendingCursor(item, cursor))
      .sort(compareAscending);
    const page = candidates.slice(0, limit + 1);
    return clone({ items: page.slice(0, limit), nextCursor: page.length > limit ? encodeCursor(page[limit - 1]) : null });
  }

  async createCommunityPost(post, audit) {
    const existing = this.communityPosts.get(post.id);
    if (existing) {
      invariant(existing.submissionKeyHash === post.submissionKeyHash && existing.payloadHash === post.payloadHash, 'CONFLICT', '幂等键已用于其他讨论内容');
      return clone(existing);
    }
    this.communityPosts.set(post.id, clone(post));
    if (audit) this.auditLogs.set(audit.id, clone(audit));
    return clone(post);
  }

  async consumeCommunityRateLimit(actorId, scope, at, max, windowMs) {
    const windowStart = Math.floor(Date.parse(at) / windowMs) * windowMs;
    const key = `${actorId}:${scope}:${windowStart}`;
    const current = this.communityRateLimits.get(key) || 0;
    invariant(current < max, 'RATE_LIMITED');
    this.communityRateLimits.set(key, current + 1);
  }

  async createCommunityReply(reply, audit) {
    const post = this.communityPosts.get(reply.postId);
    invariant(post && post.status === COMMUNITY_POST_STATUS.ACTIVE, 'NOT_FOUND');
    const existing = this.communityReplies.get(reply.id);
    if (existing) {
      invariant(existing.submissionKeyHash === reply.submissionKeyHash && existing.payloadHash === reply.payloadHash, 'CONFLICT', '幂等键已用于其他回复内容');
      return clone(existing);
    }
    this.communityReplies.set(reply.id, clone(reply));
    post.replyCount = Number(post.replyCount || 0) + 1;
    post.updatedAt = reply.createdAt;
    if (audit) this.auditLogs.set(audit.id, clone(audit));
    return clone(reply);
  }

  async deleteCommunityPost(postId, authorId, at, audit) {
    const post = this.communityPosts.get(postId);
    invariant(post && post.status !== COMMUNITY_POST_STATUS.SUSPENDED, 'NOT_FOUND');
    invariant(post.authorId === authorId, 'FORBIDDEN');
    if (post.status !== COMMUNITY_POST_STATUS.DELETED) Object.assign(post, { status: COMMUNITY_POST_STATUS.DELETED, deletedAt: at, updatedAt: at });
    if (audit) this.auditLogs.set(audit.id, clone(audit));
    return clone(post);
  }

  async deleteCommunityReply(replyId, authorId, at, audit) {
    const reply = this.communityReplies.get(replyId);
    invariant(reply && reply.status !== COMMUNITY_REPLY_STATUS.SUSPENDED, 'NOT_FOUND');
    invariant(reply.authorId === authorId, 'FORBIDDEN');
    if (reply.status !== COMMUNITY_REPLY_STATUS.DELETED) {
      Object.assign(reply, { status: COMMUNITY_REPLY_STATUS.DELETED, deletedAt: at, updatedAt: at });
      const post = this.communityPosts.get(reply.postId);
      if (post && post.status === COMMUNITY_POST_STATUS.ACTIVE) {
        post.replyCount = Math.max(0, Number(post.replyCount || 0) - 1);
        post.updatedAt = at;
      }
    }
    if (audit) this.auditLogs.set(audit.id, clone(audit));
    return clone(reply);
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
      : (effectiveActivity.maxMembers || effectiveActivity.maxPassengers || effectiveActivity.targetMembers))) {
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
      : (activity.maxMembers || activity.maxPassengers || activity.targetMembers);
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
      : (activity.minMembers || activity.minPassengers || activity.targetMembers);
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
      'RIDE_MEMBER_LOCKED'
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
    const contact = this.memberContacts.get(stableEntityId('memberContact', activityId, member.id));
    if (contact) Object.assign(contact, { status: 'INACTIVE', updatedAt: at });
    activity.memberCount = Math.max(1, activity.memberCount - 1);
    activity.version += 1;
    activity.updatedAt = at;
    const threshold = activity.type === 'ride'
      ? rideThreshold(activity)
      : (activity.minMembers || activity.minPassengers || activity.targetMembers);
    if (activity.status === ACTIVITY_STATUS.FORMED && activity.memberCount < threshold) {
      activity.status = ACTIVITY_STATUS.RECRUITING;
      delete activity.formedAt;
    }
    if (activity.type === 'ride') {
      activity.rideFulfillment = effectiveActivity.rideFulfillment;
      activity.rideJoinable = isRideJoinable(activity, at);
      activity.avatarRoster = removeAvatarRosterMember(activity.avatarRoster, member.id);
    }
    for (const item of this.applications.values()) {
      if (item.activityId === activityId && item.applicantId === actorId && item.status === APPLICATION_STATUS.APPROVED) {
        item.status = APPLICATION_STATUS.LEFT;
        item.updatedAt = at;
      }
    }
    return clone({ activity, member });
  }

  async joinRideAtomic({ activityId, actorId, luggageType, phone, avatarKind, at }) {
    invariant(MEMBER_LUGGAGE_TYPES.includes(luggageType), 'VALIDATION_ERROR', '我的行李选项无效');
    invariant(PASSENGER_AVATAR_KINDS.includes(avatarKind), 'PROFILE_INCOMPLETE', '请先补全性别资料');
    const activity = this.activities.get(activityId);
    const fulfillment = this.rideFulfillments.get(activityId);
    invariant(activity && activity.type === 'ride' && fulfillment, 'NOT_FOUND');
    invariant(activity.ownerId !== actorId, 'CONFLICT', '发起者已经在行程中');
    invariant(fulfillment.driverId !== actorId, 'FORBIDDEN', '同一行程不能同时作为司机和乘客');
    const memberId = stableEntityId('member', activityId, actorId);
    const existing = this.members.get(memberId);
    if (existing && existing.status === MEMBER_STATUS.ACTIVE) {
      return clone({ activity: { ...activity, rideFulfillment: rideFulfillmentSummary(fulfillment) }, member: existing, joined: false });
    }
    const effectiveActivity = normalizeRideCapacity({ ...activity, rideFulfillment: rideFulfillmentSummary(fulfillment) });
    invariant(isRideJoinable(effectiveActivity, at), activity.memberCount >= rideCapacity(activity) ? 'CAPACITY_FULL' : 'CONFLICT', '该行程当前不可加入');
    const member = existing || { id: memberId, activityId, userId: actorId, role: 'MEMBER' };
    Object.assign(member, { status: MEMBER_STATUS.ACTIVE, joinedAt: at, luggageType, avatarKind });
    delete member.leftAt;
    delete member.leaveReason;
    this.members.set(memberId, member);
    const contactId = stableEntityId('memberContact', activityId, memberId);
    const previousContact = this.memberContacts.get(contactId);
    this.memberContacts.set(contactId, {
      ...(previousContact || { id: contactId, activityId, memberId, userId: actorId, createdAt: at }),
      phone,
      status: 'ACTIVE',
      updatedAt: at
    });
    activity.memberCount += 1;
    activity.avatarRoster = upsertAvatarRoster(effectiveActivity.avatarRoster, member.id, avatarKind);
    Object.assign(activity, normalizeRideCapacity(activity));
    if (activity.status === ACTIVITY_STATUS.FORMED) activity.formedAt = activity.formedAt || at;
    activity.rideFulfillment = rideFulfillmentSummary(fulfillment);
    activity.rideJoinable = isRideJoinable(activity, at);
    activity.updatedAt = at;
    activity.version += 1;
    const application = this.applications.get(stableEntityId('application', activityId, actorId));
    if (application) Object.assign(application, { status: APPLICATION_STATUS.APPROVED, approvedAt: at, updatedAt: at });
    return clone({ activity, member, joined: true });
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

  async getGroupSpace(activityId, actorId) {
    const activity = this.activities.get(activityId);
    invariant(activity, 'NOT_FOUND');
    invariant([ACTIVITY_STATUS.FORMED, ACTIVITY_STATUS.IN_PROGRESS].includes(activity.status), 'CONFLICT', '仅成团中的活动可使用成员空间');
    const member = [...this.members.values()].find(
      (item) => item.activityId === activityId && item.userId === actorId && item.status === MEMBER_STATUS.ACTIVE
    );
    invariant(member, 'FORBIDDEN');
    const members = [...this.members.values()]
      .filter((item) => item.activityId === activityId && item.status === MEMBER_STATUS.ACTIVE)
      .sort((left, right) => String(left.joinedAt).localeCompare(String(right.joinedAt)))
      .map((item) => {
        const user = this.users.get(item.userId);
        const contact = this.memberContacts.get(stableEntityId('memberContact', activityId, item.id));
        return {
          memberId: item.id,
          role: item.role,
          nickname: user && user.profile && user.profile.nickname || '拼吧用户',
          isSelf: item.userId === actorId,
          sharedContact: contact && contact.status === 'ACTIVE' && contact.shared === true
            ? { type: contact.type, value: contact.value }
            : null
        };
      });
    return clone({
      activityId,
      meeting: {
        city: activity.city,
        district: activity.district,
        placeLabel: activity.placeLabel,
        note: activity.rules || ''
      },
      members
    });
  }

  async setGroupContact({ activityId, actorId, type, value, shared, at }) {
    const activity = this.activities.get(activityId);
    invariant(activity, 'NOT_FOUND');
    invariant([ACTIVITY_STATUS.FORMED, ACTIVITY_STATUS.IN_PROGRESS].includes(activity.status), 'CONFLICT', '仅成团中的活动可共享联系方式');
    const member = [...this.members.values()].find(
      (item) => item.activityId === activityId && item.userId === actorId && item.status === MEMBER_STATUS.ACTIVE
    );
    invariant(member, 'FORBIDDEN');
    const id = stableEntityId('memberContact', activityId, member.id);
    const previous = this.memberContacts.get(id);
    this.memberContacts.set(id, {
      ...(previous || { id, activityId, memberId: member.id, userId: actorId, createdAt: at }),
      type: shared ? type : null,
      value: shared ? value : null,
      shared: shared === true,
      status: shared ? 'ACTIVE' : 'INACTIVE',
      updatedAt: at
    });
    return this.getGroupSpace(activityId, actorId);
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
    const passengerMember = this.members.get(stableEntityId('member', activityId, driverId));
    invariant(!passengerMember || passengerMember.status !== MEMBER_STATUS.ACTIVE, 'FORBIDDEN', '同一行程不能同时作为司机和乘客');
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

  async listRideMemberContactsForAssignedDriver(activityId, driverId) {
    const activity = this.activities.get(activityId);
    const fulfillment = this.rideFulfillments.get(activityId);
    invariant(activity && activity.type === 'ride' && fulfillment, 'NOT_FOUND');
    invariant(
      [ACTIVITY_STATUS.RECRUITING, ACTIVITY_STATUS.FORMED, ACTIVITY_STATUS.IN_PROGRESS].includes(activity.status),
      'CONFLICT',
      '该行程当前不可查看成员联系方式'
    );
    invariant(
      fulfillment.status === RIDE_FULFILLMENT_STATUS.ASSIGNED && fulfillment.driverId === driverId,
      'FORBIDDEN'
    );
    const members = [...this.members.values()]
      .filter((member) => member.activityId === activityId && member.status === MEMBER_STATUS.ACTIVE)
      .sort((left, right) => Date.parse(left.joinedAt) - Date.parse(right.joinedAt));
    const items = members.map((member) => {
      const contact = this.memberContacts.get(stableEntityId('memberContact', activityId, member.id));
      invariant(contact && contact.status === 'ACTIVE' && contact.phone, 'CONTACT_INCOMPLETE');
      const user = this.users.get(member.userId);
      return {
        memberId: member.id,
        nickname: user && user.profile && user.profile.nickname || (member.role === 'OWNER' ? '发起者' : '乘客'),
        phone: contact.phone,
        luggageType: member.luggageType || null,
        role: member.role
      };
    });
    const currentFulfillment = this.rideFulfillments.get(activityId);
    invariant(
      currentFulfillment
        && currentFulfillment.status === RIDE_FULFILLMENT_STATUS.ASSIGNED
        && currentFulfillment.driverId === driverId,
      'FORBIDDEN'
    );
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

  async resolveDirectMessagePeer(activityId, actorId, memberId) {
    const activity = this.activities.get(activityId);
    invariant(activity && [ACTIVITY_STATUS.FORMED, ACTIVITY_STATUS.IN_PROGRESS].includes(activity.status), 'NOT_FOUND_OR_NOT_ALLOWED');
    const actorMember = [...this.members.values()].find(
      (item) => item.activityId === activityId && item.userId === actorId && item.status === MEMBER_STATUS.ACTIVE
    );
    const targetMember = this.members.get(memberId);
    invariant(
      actorMember
        && targetMember
        && targetMember.activityId === activityId
        && targetMember.status === MEMBER_STATUS.ACTIVE
        && targetMember.userId !== actorId,
      'NOT_FOUND_OR_NOT_ALLOWED'
    );
    const peer = this.users.get(targetMember.userId);
    invariant(peer && peer.status === 'ACTIVE', 'NOT_FOUND_OR_NOT_ALLOWED');
    return clone({ activity, peerUserId: peer.id });
  }

  async upsertDirectConversation(conversation) {
    const sourceActivity = conversation.source && this.activities.get(conversation.source.id);
    const activeParticipants = [...this.members.values()].filter(
      (item) => item.activityId === (conversation.source && conversation.source.id)
        && [conversation.participantAId, conversation.participantBId].includes(item.userId)
        && item.status === MEMBER_STATUS.ACTIVE
    );
    invariant(sourceActivity && [ACTIVITY_STATUS.FORMED, ACTIVITY_STATUS.IN_PROGRESS].includes(sourceActivity.status) && activeParticipants.length === 2
      && [conversation.participantAId, conversation.participantBId].every((id) => this.users.get(id)?.status === 'ACTIVE'), 'NOT_FOUND_OR_NOT_ALLOWED');
    const existing = this.directConversations.get(conversation.id);
    if (existing) return clone(existing);
    this.directConversations.set(conversation.id, clone(conversation));
    return clone(conversation);
  }

  async getDirectConversation(conversationId) {
    return clone(this.directConversations.get(conversationId) || null);
  }

  async getDirectMessage(messageId) {
    return clone(this.directMessages.get(messageId) || null);
  }

  async isDirectMessagingAvailable(conversation) {
    const activityId = conversation.source && conversation.source.id;
    const activity = this.activities.get(activityId);
    return Boolean(activity && [ACTIVITY_STATUS.FORMED, ACTIVITY_STATUS.IN_PROGRESS].includes(activity.status)
      && [conversation.participantAId, conversation.participantBId].every((userId) => {
        const user = this.users.get(userId);
        return user && user.status === 'ACTIVE' && [...this.members.values()].some((member) =>
          member.activityId === activityId && member.userId === userId && member.status === MEMBER_STATUS.ACTIVE);
      }));
  }

  async listDirectConversations(actorId, { cursor, limit }) {
    const candidates = [...this.directConversations.values()]
      .filter((item) => [item.participantAId, item.participantBId].includes(actorId))
      .filter((item) => isAfterDirectCursor(item, cursor, 'updatedAt'))
      .sort((left, right) => compareDirectDescending(left, right, 'updatedAt'));
    const page = candidates.slice(0, limit + 1);
    const items = page.slice(0, limit);
    return clone({
      items,
      nextCursor: page.length > limit ? encodeDirectCursor(items[items.length - 1], 'updatedAt') : null
    });
  }

  async listDirectMessages(conversationId, actorId, { cursor, limit }) {
    const conversation = this.directConversations.get(conversationId);
    invariant(conversation && [conversation.participantAId, conversation.participantBId].includes(actorId), 'NOT_FOUND_OR_NOT_ALLOWED');
    const candidates = [...this.directMessages.values()]
      .filter((item) => item.conversationId === conversationId)
      .filter((item) => isAfterDirectCursor(item, cursor, 'createdAt'))
      .sort((left, right) => compareDirectDescending(left, right, 'createdAt'));
    const page = candidates.slice(0, limit + 1);
    const items = page.slice(0, limit);
    return clone({
      items,
      nextCursor: page.length > limit ? encodeDirectCursor(items[items.length - 1], 'createdAt') : null
    });
  }

  async addDirectMessage(message) {
    const conversation = this.directConversations.get(message.conversationId);
    invariant(conversation && [conversation.participantAId, conversation.participantBId].includes(message.senderId), 'NOT_FOUND_OR_NOT_ALLOWED');
    const existing = this.directMessages.get(message.id);
    if (existing) {
      invariant(existing.conversationId === message.conversationId && existing.senderId === message.senderId, 'CONFLICT', '客户端消息ID已用于其他会话');
      invariant(existing.payloadHash === message.payloadHash, 'CONFLICT', '客户端消息ID已用于其他内容');
      return clone(existing);
    }
    const sourceActivity = conversation.source && this.activities.get(conversation.source.id);
    const activeParticipants = [...this.members.values()].filter(
      (item) => item.activityId === (conversation.source && conversation.source.id)
        && [conversation.participantAId, conversation.participantBId].includes(item.userId)
        && item.status === MEMBER_STATUS.ACTIVE
    );
    invariant(sourceActivity && [ACTIVITY_STATUS.FORMED, ACTIVITY_STATUS.IN_PROGRESS].includes(sourceActivity.status) && activeParticipants.length === 2
      && [conversation.participantAId, conversation.participantBId].every((id) => this.users.get(id)?.status === 'ACTIVE'), 'CONFLICT', '共同活动或成员关系已失效，这段私信现为只读');
    const recipientId = conversation.participantAId === message.senderId
      ? conversation.participantBId
      : conversation.participantAId;
    this.directMessages.set(message.id, clone(message));
    conversation.lastMessageId = message.id;
    conversation.lastMessagePreview = message.text.slice(0, 80);
    conversation.lastMessageAt = message.createdAt;
    conversation.lastSenderId = message.senderId;
    conversation.updatedAt = message.createdAt;
    conversation.unreadByUser = {
      ...(conversation.unreadByUser || {}),
      [message.senderId]: Number(conversation.unreadByUser && conversation.unreadByUser[message.senderId]) || 0,
      [recipientId]: (Number(conversation.unreadByUser && conversation.unreadByUser[recipientId]) || 0) + 1
    };
    return clone(message);
  }

  async markDirectConversationRead(conversationId, actorId, lastMessageId, at) {
    const conversation = this.directConversations.get(conversationId);
    invariant(conversation && [conversation.participantAId, conversation.participantBId].includes(actorId), 'NOT_FOUND_OR_NOT_ALLOWED');
    if (!conversation.lastMessageId || conversation.lastMessageId !== lastMessageId) return clone(conversation);
    conversation.unreadByUser = { ...(conversation.unreadByUser || {}), [actorId]: 0 };
    conversation.readAtByUser = { ...(conversation.readAtByUser || {}), [actorId]: at };
    return clone(conversation);
  }

  async getDirectUnreadSummary(actorId) {
    const items = [...this.directConversations.values()].filter(
      (item) => [item.participantAId, item.participantBId].includes(actorId)
    );
    return {
      totalUnread: items.reduce((sum, item) => sum + Math.max(0, Number(item.unreadByUser && item.unreadByUser[actorId]) || 0), 0),
      conversationsWithUnread: items.filter((item) => Number(item.unreadByUser && item.unreadByUser[actorId]) > 0).length
    };
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
