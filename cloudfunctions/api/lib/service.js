'use strict';

const crypto = require('crypto');
const { AppError, invariant, toPublicError } = require('./errors');
const { stableEntityId } = require('./ids');
const {
  ACTIVITY_STATUS,
  APPLICATION_STATUS,
  RIDE_FULFILLMENT_STATUS,
  DRIVER_REVIEW_STATUS,
  DRIVER_STATUS,
  VEHICLE_REVIEW_STATUS,
  VEHICLE_STATUS
} = require('./constants');
const {
  validateActivityInput,
  validateActivityListInput,
  validateRideJoinInput,
  validateRideDriverAcceptInput,
  validateRideDriverCancelInput,
  validateApplicationInput,
  validateProfileInput,
  validateOnboardingRoleInput,
  validateDriverApplicationInput,
  validateDriverDocumentPrepareInput,
  validateDriverDocumentConfirmInput,
  validateReportInput,
  validateActivityQuestionInput,
  validateActivityQuestionAnswerInput,
  validateId,
  requireIdempotencyKey,
  stringValue
} = require('./validation');
const { protectDriverApplication } = require('./driver-credentials');
const { createLocalModeration } = require('./moderation');
const { resolveNotificationTarget } = require('./notification-target');
const { parsePublicCursor, normalizeActivityForRead } = require('./public-activity-page');
const {
  rideCapacity,
  isRidePassengerJoinable,
  ridePassengerJoinUnavailableReason,
  isRidePassengerLeaveable,
  rideDriverAvailability,
  normalizeRideCapacity
} = require('./ride-policy');
const {
  avatarKindFromGender,
  isCompleteRideProfile,
  publicAvatarSlots,
  upsertAvatarRoster
} = require('./passenger-avatar');

const MUTATING_ACTIONS = new Set([
  'profile.update',
  'onboarding.selectRole',
  'driver.application.submit',
  'driver.document.prepare',
  'driver.document.confirm',
  'driver.application.withdraw',
  'admin.driverApplication.review',
  'activity.create',
  'activity.cancel',
  'activity.complete',
  'activity.question.ask',
  'activity.question.answer',
  'application.submit',
  'application.approve',
  'application.reject',
  'application.withdraw',
  'ride.join',
  'member.leave',
  'ride.driver.accept',
  'ride.driver.cancel',
  'notification.read',
  'report.create',
  'admin.activity.suspend'
]);
const BUSINESS_IDEMPOTENT_ACTIONS = new Set(['driver.application.submit', 'admin.driverApplication.review']);

function stableSerialize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

// Authenticated self-profile DTO. It is never used by public activity endpoints.
function selfUser(user) {
  if (!user) return null;
  return {
    role: user.role,
    status: user.status,
    onboarding: user.onboarding
      ? { roleIntent: user.onboarding.roleIntent, completedAt: user.onboarding.completedAt }
      : { roleIntent: null, completedAt: null },
    profile: user.profile
      ? {
          nickname: user.profile.nickname,
          gender: user.profile.gender || null,
          city: user.profile.city,
          interests: user.profile.interests || [],
          adultConfirmed: user.profile.adultConfirmed === true
        }
      : null,
    profileComplete: isCompleteRideProfile(user.profile)
  };
}

function publicDriverApplication(application) {
  if (!application) return null;
  return {
    status: application.status,
    revision: application.revision,
    summary: application.summary ? {
      legalNameMasked: application.summary.legalNameMasked,
      identityType: application.summary.identityType,
      identityLast4: application.summary.identityLast4,
      identityExpiresAt: application.summary.identityExpiresAt,
      driverLicenseLast4: application.summary.driverLicenseLast4,
      driverLicenseExpiresAt: application.summary.driverLicenseExpiresAt,
      vehicleType: application.summary.vehicleType,
      passengerCapacity: application.summary.passengerCapacity,
      plateMasked: application.summary.plateMasked,
      documentKinds: application.summary.documentKinds || []
    } : null,
    review: application.review ? {
      reasonCode: application.review.reasonCode || '',
      reviewedAt: application.review.reviewedAt || null
    } : null,
    submittedAt: application.submittedAt || null,
    updatedAt: application.updatedAt
  };
}

function publicActivity(activity, viewer = {}, at) {
  activity = normalizeRideCapacity(activity);
  const maxPassengers = activity.maxPassengers || activity.targetMembers;
  const minPassengers = activity.minPassengers || activity.targetMembers;
  const result = {
    id: activity.id,
    type: activity.type,
    title: activity.title,
    description: activity.description,
    city: activity.city,
    district: activity.district,
    placeLabel: activity.placeLabel,
    startsAt: activity.startsAt,
    deadlineAt: activity.deadlineAt,
    targetMembers: activity.targetMembers,
    minPassengers,
    maxPassengers,
    memberCount: activity.memberCount,
    remainingCapacity: Math.max(0, Number(maxPassengers) - Number(activity.memberCount || 0)),
    status: activity.status,
    rules: activity.rules,
    typeData: activity.typeData,
    owner: activity.owner && activity.owner.nickname
      ? { nickname: activity.owner.nickname }
      : null,
    createdAt: activity.createdAt,
    updatedAt: activity.updatedAt
  };
  if (activity.type === 'ride') {
    result.avatarSlots = publicAvatarSlots(activity.avatarRoster, maxPassengers);
    result.rideFulfillment = publicRideFulfillment(activity.rideFulfillment);
    const availability = rideDriverAvailability(activity, at);
    result.rideJoinable = isRidePassengerJoinable(activity, at);
    result.driverAcceptable = availability.acceptable;
    result.driverUnacceptableReason = availability.reason;
  }
  if (viewer.application) {
    result.viewerApplication = {
      id: viewer.application.id,
      status: viewer.application.status,
      note: viewer.application.note,
      createdAt: viewer.application.createdAt
    };
  }
  if (viewer.member) {
    result.viewerMembership = {
      role: viewer.member.role,
      status: viewer.member.status,
      joinedAt: viewer.member.joinedAt,
      ...(activity.type === 'ride' ? { luggageType: viewer.member.luggageType || null } : {})
    };
  }
  result.viewerRole = viewer.role || 'guest';
  if (activity.type === 'ride') {
    result.canJoinRide = result.rideJoinable === true
      && (result.viewerRole === 'guest' || result.viewerRole === 'applicant');
    result.joinUnavailableReason = result.canJoinRide
      ? ''
      : result.viewerRole === 'owner'
        ? '这是你发布的行程'
        : result.viewerRole === 'member'
          ? '你已加入该行程'
          : result.viewerRole === 'driver'
            ? '你已承接该行程，不能同时作为乘客'
            : ridePassengerJoinUnavailableReason(activity, at);
    result.canLeaveRide = result.viewerRole === 'member' && isRidePassengerLeaveable(activity);
    result.rideExitLocked = result.viewerRole === 'member'
      && activity.rideFulfillment
      && activity.rideFulfillment.status !== RIDE_FULFILLMENT_STATUS.UNASSIGNED;
  }
  return result;
}

function publicRideFulfillment(fulfillment) {
  if (!fulfillment) return null;
  const result = {
    status: fulfillment.status,
    pickupAt: fulfillment.pickupAt || null,
    assignedAt: fulfillment.assignedAt || null
  };
  if (fulfillment.driver && fulfillment.driver.nickname) {
    result.driver = { nickname: fulfillment.driver.nickname };
  }
  if (fulfillment.vehicle) {
    result.vehicle = {
      type: fulfillment.vehicle.type,
      plateMasked: fulfillment.vehicle.plateMasked
    };
  }
  return result;
}

function publicDriverProfile(driver, vehicles = []) {
  if (!driver) return { canAcceptRide: false, vehicles: [] };
  return {
    canAcceptRide: driver.status === DRIVER_STATUS.ACTIVE
      && driver.reviewStatus === DRIVER_REVIEW_STATUS.APPROVED,
    vehicles: vehicles.map((vehicle) => ({
      id: vehicle.id,
      canUseForRide: vehicle.status === VEHICLE_STATUS.ACTIVE
        && vehicle.reviewStatus === VEHICLE_REVIEW_STATUS.APPROVED,
      type: vehicle.type,
      plateMasked: vehicle.plateMasked,
      passengerCapacity: vehicle.passengerCapacity
    }))
  };
}

function publicApplication(application) {
  return {
    id: application.id,
    status: application.status,
    note: application.note || '',
    autoJoinConsent: application.autoJoinConsent === true,
    applicant: application.applicant && application.applicant.nickname
      ? { nickname: application.applicant.nickname }
      : null,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
    approvedAt: application.approvedAt
  };
}

function publicNotification(notification) {
  return {
    id: notification.id,
    type: notification.type,
    target: resolveNotificationTarget(notification.type),
    activityId: notification.activityId,
    title: notification.title,
    read: notification.read === true,
    createdAt: notification.createdAt,
    readAt: notification.readAt
  };
}

function publicActivityQuestion(question) {
  return {
    id: question.id,
    activityId: question.activityId,
    content: question.content,
    asker: question.asker && question.asker.nickname
      ? { nickname: question.asker.nickname }
      : null,
    answer: question.answer
      ? {
          content: question.answer.content,
          responder: question.answer.responder && question.answer.responder.nickname
            ? { nickname: question.answer.responder.nickname }
            : null,
          answeredAt: question.answer.answeredAt
        }
      : null,
    createdAt: question.createdAt,
    updatedAt: question.updatedAt
  };
}

function createPinbaService(options) {
  const store = options && options.store;
  invariant(store, 'INTERNAL', 'Store 未配置');
  const moderation = options.moderation || createLocalModeration();
  const clock = options.clock || (() => new Date());
  const idGenerator = options.idGenerator || (() => crypto.randomUUID());
  const rideDriverAcceptanceEnabled = options.rideDriverAcceptanceEnabled === true;
  const driverCredentialSecret = options.driverCredentialSecret || '';
  const driverReviewEnabled = options.driverReviewEnabled === true;
  const driverApplicationAutoApprove = options.driverApplicationAutoApprove === true;
  const driverAutoApprovalEnvironment = options.driverAutoApprovalEnvironment || '';

  function nowIso() {
    return clock().toISOString();
  }

  function operationId(context, scope) {
    const actorId = requireActor(context);
    const key = context && context.idempotencyKey;
    invariant(key, 'INTERNAL', '写操作上下文缺少幂等键');
    const label = String(scope)
      .split(':', 1)[0]
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 18) || 'operation';
    return stableEntityId(label, actorId, key, scope);
  }

  function requireActor(context) {
    const actorId = context && context.actorId;
    invariant(actorId, 'UNAUTHENTICATED');
    return actorId;
  }

  function assertActiveAccount(user) {
    invariant(user, 'UNAUTHENTICATED');
    invariant(user.status === 'ACTIVE', 'ACCOUNT_DISABLED');
    return user;
  }

  async function requireActiveUser(context, requireProfile = true) {
    const actorId = requireActor(context);
    const user = assertActiveAccount(await store.getUser(actorId));
    if (requireProfile) invariant(user.profile && user.profile.adultConfirmed === true, 'PROFILE_INCOMPLETE');
    return user;
  }

  async function runAction(action, input, context) {
    const at = nowIso();

    if (action === 'auth.login') {
      const actorId = requireActor(context);
      const user = assertActiveAccount(await store.ensureUser(actorId, at));
      const driverApplication = typeof store.getDriverApplication === 'function'
        ? await store.getDriverApplication(actorId)
        : null;
      return {
        user: selfUser(user),
        onboarding: {
          profileComplete: isCompleteRideProfile(user.profile),
          roleIntent: user.onboarding && user.onboarding.roleIntent || null,
          driverApplication: publicDriverApplication(driverApplication)
        },
        sessionScope: stableEntityId('session', actorId)
      };
    }

    if (action === 'profile.get') {
      return { user: selfUser(await requireActiveUser(context, false)) };
    }

    if (action === 'profile.update') {
      const actorId = requireActor(context);
      assertActiveAccount(await store.ensureUser(actorId, at));
      const profile = validateProfileInput(input);
      const user = await store.updateProfile(actorId, profile, at);
      if (typeof store.syncUserAvatarKind === 'function') {
        try {
          await store.syncUserAvatarKind(actorId, avatarKindFromGender(profile.gender), at);
        } catch (error) {
          // The self profile is the source of truth. A snapshot sync failure must
          // not make the already-persisted profile look unsaved to the client.
          console.error('[pinba-avatar-sync]', actorId, error && error.stack ? error.stack : error);
        }
      }
      await store.addAudit({ id: operationId(context, 'audit'), actorId, action, targetType: 'user', targetId: actorId, at });
      return { user: selfUser(user) };
    }

    if (action === 'onboarding.selectRole') {
      const actorId = requireActor(context);
      assertActiveAccount(await store.ensureUser(actorId, at));
      const payload = validateOnboardingRoleInput(input);
      const user = await store.updateOnboardingRole(actorId, payload.roleIntent, at);
      await store.addAudit({ id: operationId(context, 'audit'), actorId, action, targetType: 'user', targetId: actorId, at });
      return { user: selfUser(user) };
    }

    if (action === 'driver.application.get') {
      const user = await requireActiveUser(context, false);
      return { application: publicDriverApplication(await store.getDriverApplication(user.id)) };
    }

    if (action === 'driver.document.prepare') {
      const user = await requireActiveUser(context);
      const payload = validateDriverDocumentPrepareInput(input);
      const uploadId = operationId(context, `driver-upload:${payload.kind}`);
      const ownerScope = stableEntityId('driver-upload-owner', user.id);
      const cloudPath = `private-driver/${ownerScope}/${uploadId}-${payload.kind}.jpg`;
      const upload = {
        id: uploadId, userId: user.id, kind: payload.kind, cloudPath,
        status: 'PREPARED', expiresAt: new Date(Date.parse(at) + 30 * 60 * 1000).toISOString(),
        createdAt: at, updatedAt: at
      };
      await store.registerDriverDocumentUpload(upload);
      return { upload: { id: upload.id, kind: upload.kind, cloudPath: upload.cloudPath, expiresAt: upload.expiresAt } };
    }

    if (action === 'driver.document.confirm') {
      const user = await requireActiveUser(context);
      const payload = validateDriverDocumentConfirmInput(input);
      const upload = await store.confirmDriverDocumentUpload({
        userId: user.id,
        ...payload,
        at
      });
      return {
        document: {
          uploadId: upload.id,
          kind: upload.kind,
          inspectedAt: upload.inspectedAt
        }
      };
    }

    if (action === 'driver.application.submit') {
      const user = await requireActiveUser(context);
      const payload = validateDriverApplicationInput(input, clock());
      const current = await store.getDriverApplication(user.id);
      const payloadHash = crypto.createHash('sha256').update(stableSerialize(payload)).digest('hex');
      const operationKeyHash = operationId(context, 'driver-application-operation');
      if (current && current.operationKeyHash === operationKeyHash) {
        invariant(current.payloadHash === payloadHash, 'CONFLICT', '幂等键已用于其他司机认证资料');
        if (driverApplicationAutoApprove && current.status === 'APPROVED') {
          await store.ensureApprovedDriverFacts(user.id, current, current.updatedAt);
        }
        return { application: publicDriverApplication(current) };
      }
      invariant(
        !current || !['SUBMITTED', 'APPROVED'].includes(current.status),
        current && current.status === 'SUBMITTED' ? 'DRIVER_APPLICATION_PENDING' : 'DRIVER_APPLICATION_LOCKED'
      );
      const documentRefs = await store.resolveDriverDocumentReferences(user.id, payload.documents, at);
      const protectedInput = { ...payload, documents: documentRefs };
      const protectedPayload = protectDriverApplication(protectedInput, driverCredentialSecret, { userId: user.id, keyVersion: 1 });
      const application = {
        id: user.id,
        userId: user.id,
        status: driverApplicationAutoApprove ? 'APPROVED' : 'SUBMITTED',
        revision: Number(current && current.revision || 0) + 1,
        operationKeyHash,
        payloadHash,
        documentUploadIds: Object.fromEntries(Object.entries(documentRefs).map(([kind, reference]) => [kind, reference.uploadId])),
        documentFileHashes: Object.fromEntries(Object.entries(documentRefs).map(([kind, reference]) => [kind, crypto.createHash('sha256').update(reference.fileID).digest('hex')])),
        summary: protectedPayload.summary,
        consent: { ...payload.consent, at },
        submittedAt: at,
        createdAt: current && current.createdAt || at,
        updatedAt: at
      };
      if (driverApplicationAutoApprove) {
        application.review = {
          reviewerId: 'system:dev-auto-approval',
          reasonCode: 'DEV_AUTO_APPROVED',
          reviewedAt: at
        };
      }
      const stored = await store.submitDriverApplication({
        userId: user.id,
        application,
        secrets: protectedPayload.secrets,
        documentRefs,
        autoApprove: driverApplicationAutoApprove,
        audit: {
          id: operationId(context, 'audit'),
          actorId: user.id,
          action,
          targetType: 'driverApplication',
          targetId: user.id,
          ...(driverApplicationAutoApprove ? {
            decision: 'APPROVED',
            reasonCode: 'DEV_AUTO_APPROVED',
            reviewActor: 'system:dev-auto-approval',
            autoApprovalEnvironment: driverAutoApprovalEnvironment,
            autoApprovalGateEnabled: true
          } : {}),
          at
        }
      });
      return { application: publicDriverApplication(stored) };
    }

    if (action === 'driver.application.withdraw') {
      const user = await requireActiveUser(context, false);
      const application = await store.withdrawDriverApplication(user.id, at, {
        id: operationId(context, 'audit'), actorId: user.id, action, targetType: 'driverApplication', targetId: user.id, at
      });
      return { application: publicDriverApplication(application) };
    }

    if (action === 'admin.driverApplication.review') {
      const reviewer = await requireActiveUser(context, false);
      invariant(driverReviewEnabled && reviewer.role === 'admin', 'DRIVER_REVIEW_FORBIDDEN');
      const userId = validateId(input && input.userId, '申请人ID');
      const decision = stringValue(input && input.decision, '审核决定', { required: true, max: 30 });
      invariant(['APPROVED', 'REJECTED', 'NEEDS_MORE_INFO'].includes(decision), 'VALIDATION_ERROR', '审核决定无效');
      const reasonCode = stringValue(input && input.reasonCode, '原因代码', { max: 40 });
      const reviewPayloadHash = crypto.createHash('sha256').update(stableSerialize({ userId, decision, reasonCode })).digest('hex');
      const application = await store.reviewDriverApplication({
        userId, reviewerId: reviewer.id, decision, reasonCode, reviewPayloadHash, at,
        audit: {
          id: operationId(context, `audit:${userId}`), operationKeyHash: operationId(context, `driver-review-operation:${userId}`),
          actorId: reviewer.id, action, targetType: 'driverApplication', targetId: userId, at
        }
      });
      return { application: publicDriverApplication(application) };
    }

    if (action === 'activity.list') {
      const validatedFilters = validateActivityListInput(input);
      const filters = {
        ...validatedFilters,
        cursor: parsePublicCursor(input && input.cursor),
        limit: Math.min(Math.max(Number(input && input.limit) || 20, 1), 50)
      };
      const page = await store.listActivities(filters, at);
      return {
        items: page.items.map((item) => publicActivity(item, {}, at)),
        nextCursor: page.nextCursor || null
      };
    }

    if (action === 'activity.detail') {
      const activityId = validateId(input && input.activityId, '活动ID');
      const storedActivity = await store.getActivity(activityId);
      const activity = normalizeActivityForRead(storedActivity, at);
      invariant(activity, 'NOT_FOUND');
      invariant(activity.status !== ACTIVITY_STATUS.SUSPENDED, 'TAKEDOWN');
      const actorId = context && context.actorId;
      const viewer = actorId ? await store.getViewerContext(activityId, actorId) : {};
      return { activity: publicActivity(activity, viewer, at) };
    }

    if (action === 'activity.question.list') {
      const activityId = validateId(input && input.activityId, '活动ID');
      const activity = normalizeActivityForRead(await store.getActivity(activityId), at);
      invariant(activity, 'NOT_FOUND');
      invariant(activity.status !== ACTIVITY_STATUS.SUSPENDED, 'TAKEDOWN');
      invariant(activity.status !== ACTIVITY_STATUS.DRAFT, 'NOT_FOUND');
      const cursor = parsePublicCursor(input && input.cursor);
      const limit = Math.min(Math.max(Number(input && input.limit) || 10, 1), 10);
      const page = await store.listActivityQuestions(activityId, { cursor, limit });
      return {
        items: page.items.map(publicActivityQuestion),
        nextCursor: page.nextCursor || null
      };
    }

    if (action === 'activity.question.ask') {
      const user = await requireActiveUser(context, false);
      const payload = validateActivityQuestionInput(input);
      const activity = normalizeActivityForRead(await store.getActivity(payload.activityId), at);
      invariant(activity, 'NOT_FOUND');
      invariant(activity.status !== ACTIVITY_STATUS.SUSPENDED, 'TAKEDOWN');
      invariant(
        [ACTIVITY_STATUS.RECRUITING, ACTIVITY_STATUS.FORMED].includes(activity.status),
        'CONFLICT',
        '该活动当前不能提问'
      );
      await moderation.check([payload.content], { actorId: user.id, scene: 2 });
      const question = {
        id: operationId(context, `activityQuestion:${payload.activityId}`),
        activityId: payload.activityId,
        askerId: user.id,
        asker: user.profile && user.profile.nickname ? { nickname: user.profile.nickname } : null,
        content: payload.content,
        answer: null,
        submissionKeyHash: operationId(context, 'submission'),
        createdAt: at,
        updatedAt: at
      };
      const audit = {
        id: operationId(context, 'audit'),
        actorId: user.id,
        action,
        targetType: 'activityQuestion',
        targetId: question.id,
        at
      };
      const storedQuestion = await store.createActivityQuestion(question, audit);
      return { question: publicActivityQuestion(storedQuestion) };
    }

    if (action === 'activity.question.answer') {
      const owner = await requireActiveUser(context, false);
      const payload = validateActivityQuestionAnswerInput(input);
      const activity = normalizeActivityForRead(await store.getActivity(payload.activityId), at);
      invariant(activity, 'NOT_FOUND');
      invariant(activity.status !== ACTIVITY_STATUS.SUSPENDED, 'TAKEDOWN');
      invariant(activity.ownerId === owner.id, 'FORBIDDEN');
      invariant(
        [ACTIVITY_STATUS.RECRUITING, ACTIVITY_STATUS.FORMED, ACTIVITY_STATUS.IN_PROGRESS].includes(activity.status),
        'CONFLICT',
        '该活动当前不能回答问题'
      );
      await moderation.check([payload.content], { actorId: owner.id, scene: 2 });
      const audit = {
        id: operationId(context, 'audit'),
        actorId: owner.id,
        action,
        targetType: 'activityQuestion',
        targetId: payload.questionId,
        at
      };
      const storedQuestion = await store.answerActivityQuestionAtomic({
        activityId: payload.activityId,
        questionId: payload.questionId,
        ownerId: owner.id,
        answer: {
          responderId: owner.id,
          responder: owner.profile && owner.profile.nickname ? { nickname: owner.profile.nickname } : null,
          content: payload.content,
          answeredAt: at,
          operationKeyHash: operationId(context, `answer:${payload.questionId}`)
        },
        audit,
        at
      });
      return { question: publicActivityQuestion(storedQuestion) };
    }

    if (action === 'activity.mine') {
      const user = await requireActiveUser(context, false);
      const result = await store.listUserActivities(user.id, at);
      return {
        owned: result.owned.map((item) => publicActivity(item, { role: 'owner' }, at)),
        joined: result.joined.map((item) => publicActivity(item, { role: 'member' }, at))
      };
    }

    if (action === 'ride.driver.profile') {
      const user = await requireActiveUser(context, false);
      const driver = await store.getDriver(user.id);
      const vehicles = driver ? await store.listVehiclesForDriver(user.id) : [];
      return { driver: publicDriverProfile(driver, vehicles) };
    }

    if (action === 'ride.driver.mine') {
      const user = await requireActiveUser(context, false);
      const items = await store.listDriverRides(user.id);
      return {
        items: items.map((item) => ({
          activity: publicActivity(item.activity, { role: 'driver' }, at),
          rideFulfillment: publicRideFulfillment(item.fulfillment)
        }))
      };
    }

    if (action === 'ride.driver.memberContacts') {
      const user = await requireActiveUser(context, false);
      const activityId = validateId(input && input.activityId, '活动ID');
      const items = await store.listRideMemberContactsForAssignedDriver(activityId, user.id);
      return { activityId, items };
    }

    if (action === 'activity.create') {
      const user = await requireActiveUser(context);
      const payload = validateActivityInput(input, clock());
      if (payload.type === 'ride') invariant(isCompleteRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先补全性别资料');
      const { luggageType, contactInfo, ...activityPayload } = payload;
      await moderation.check([activityPayload.title, activityPayload.description, activityPayload.rules], { actorId: user.id, scene: 2 });
      const activityId = operationId(context, 'activity');
      const activity = {
        id: activityId,
        ownerId: user.id,
        owner: { nickname: user.profile.nickname },
        ...activityPayload,
        ...(payload.type === 'ride' ? {} : { contactInfo }),
        memberCount: 1,
        status: activityPayload.targetMembers === 1 ? ACTIVITY_STATUS.FORMED : ACTIVITY_STATUS.RECRUITING,
        operationKeyHash: operationId(context, 'operation'),
        version: 1,
        createdAt: at,
        updatedAt: at
      };
      const ownerMember = {
        id: stableEntityId('member', activityId, user.id),
        activityId,
        userId: user.id,
        role: 'OWNER',
        status: 'ACTIVE',
        joinedAt: at,
        ...(activity.type === 'ride' ? {
          luggageType,
          avatarKind: avatarKindFromGender(user.profile.gender)
        } : {})
      };
      if (activity.type === 'ride') {
        activity.avatarRoster = upsertAvatarRoster([], ownerMember.id, ownerMember.avatarKind);
      }
      const rideFulfillment = activity.type === 'ride'
        ? {
            id: stableEntityId('rideFulfillment', activityId),
            activityId,
            status: RIDE_FULFILLMENT_STATUS.UNASSIGNED,
            version: 1,
            createdAt: at,
            updatedAt: at
          }
        : null;
      const ownerContact = activity.type === 'ride'
        ? {
            id: stableEntityId('memberContact', activityId, ownerMember.id),
            activityId,
            memberId: ownerMember.id,
            userId: user.id,
            phone: contactInfo,
            status: 'ACTIVE',
            createdAt: at,
            updatedAt: at
          }
        : null;
      if (rideFulfillment) {
        activity.rideFulfillment = { status: RIDE_FULFILLMENT_STATUS.UNASSIGNED };
        activity.rideJoinable = true;
      }
      const storedActivity = await store.createActivityWithOwner(activity, ownerMember, rideFulfillment, ownerContact);
      await store.addAudit({ id: operationId(context, 'audit'), actorId: user.id, action, targetType: 'activity', targetId: activityId, at });
      return { activity: publicActivity(storedActivity, { role: 'owner' }, at) };
    }

    if (action === 'ride.join') {
      const user = await requireActiveUser(context);
      invariant(isCompleteRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先补全性别资料');
      const payload = validateRideJoinInput(input);
      const { activityId, luggageType, phone } = payload;
      const result = await store.joinRideAtomic({
        activityId,
        actorId: user.id,
        luggageType,
        phone,
        avatarKind: avatarKindFromGender(user.profile.gender),
        at
      });
      if (result.joined) {
        await store.addNotification({
          id: operationId(context, 'notification'),
          userId: result.activity.ownerId,
          type: 'RIDE_MEMBER_JOINED',
          activityId,
          title: `有新乘客加入“${result.activity.title}”`,
          read: false,
          createdAt: at
        });
      }
      if (result.joined) {
        await store.addAudit({ id: operationId(context, 'audit'), actorId: user.id, action, targetType: 'activity', targetId: activityId, at });
      }
      return { activity: publicActivity(result.activity, { role: 'member', member: result.member }, at) };
    }

    if (action === 'application.submit') {
      const user = await requireActiveUser(context);
      const payload = validateApplicationInput(input);
      await moderation.check([payload.note], { actorId: user.id, scene: 2 });
      const activity = await store.getActivity(payload.activityId);
      invariant(activity, 'NOT_FOUND');
      if (activity.memberCount >= (activity.type === 'ride' ? rideCapacity(activity) : (activity.maxPassengers || activity.targetMembers))) throw new AppError('CAPACITY_FULL');
      const rideJoinable = activity.type === 'ride' && isRidePassengerJoinable(normalizeRideCapacity(activity), at);
      invariant(rideJoinable || activity.status === ACTIVITY_STATUS.RECRUITING, 'CONFLICT', '该活动当前不可申请');
      invariant(activity.ownerId !== user.id, 'CONFLICT', '不能申请自己发布的活动');
      invariant(Date.parse(activity.deadlineAt) > clock().getTime(), 'CONFLICT', '该活动报名已截止');
      const application = {
        id: stableEntityId('application', payload.activityId, user.id),
        activityId: payload.activityId,
        applicantId: user.id,
        applicant: { id: user.id, nickname: user.profile.nickname },
        status: APPLICATION_STATUS.PENDING,
        note: payload.note,
        autoJoinConsent: true,
        submissionKeyHash: operationId(context, 'submission'),
        createdAt: at,
        updatedAt: at
      };
      const storedApplication = await store.createApplication(application);
      await store.addNotification({
        id: operationId(context, 'notification'),
        userId: activity.ownerId,
        type: 'NEW_APPLICATION',
        activityId: activity.id,
        title: `“${activity.title}”有新的加入申请`,
        read: false,
        createdAt: at
      });
      await store.addAudit({ id: operationId(context, 'audit'), actorId: user.id, action, targetType: 'application', targetId: application.id, at });
      return { application: publicApplication(storedApplication) };
    }

    if (action === 'application.approve') {
      const owner = await requireActiveUser(context);
      const activityId = validateId(input && input.activityId, '活动ID');
      const applicationId = validateId(input && input.applicationId, '申请ID');
      const result = await store.approveApplicationAtomic({
        activityId,
        applicationId,
        ownerId: owner.id,
        at
      });
      const justFormed = result.activity.type === 'ride'
        ? result.activity.memberCount === rideCapacity(result.activity)
        : result.activity.status === ACTIVITY_STATUS.FORMED;
      await store.addNotification({
        id: operationId(context, 'notification'),
        userId: result.application.applicantId,
        type: justFormed ? 'GROUP_FORMED' : 'APPLICATION_APPROVED',
        activityId,
        title: justFormed ? `“${result.activity.title}”已满员并成团` : `你已加入“${result.activity.title}”`,
        read: false,
        createdAt: at
      });
      for (const applicantId of result.cancelledApplicantIds || []) {
        await store.addNotification({
          id: operationId(context, `closedNotification:${applicantId}`),
          userId: applicantId,
          type: 'APPLICATION_CLOSED',
          activityId,
          title: `“${result.activity.title}”名额已满`,
          read: false,
          createdAt: at
        });
      }
      await store.addAudit({ id: operationId(context, 'audit'), actorId: owner.id, action, targetType: 'application', targetId: applicationId, at });
      return {
        activity: publicActivity(result.activity, { role: 'owner' }, at),
        application: publicApplication(result.application)
      };
    }

    if (action === 'application.reject') {
      const owner = await requireActiveUser(context);
      const applicationId = validateId(input && input.applicationId, '申请ID');
      const result = await store.rejectApplication(applicationId, owner.id, at);
      await store.addNotification({
        id: operationId(context, 'notification'),
        userId: result.application.applicantId,
        type: 'APPLICATION_REJECTED',
        activityId: result.application.activityId,
        title: `“${result.activity.title}”的申请未通过`,
        read: false,
        createdAt: at
      });
      await store.addAudit({ id: operationId(context, 'audit'), actorId: owner.id, action, targetType: 'application', targetId: applicationId, at });
      return {
        activity: publicActivity(result.activity, { role: 'owner' }, at),
        application: publicApplication(result.application)
      };
    }

    if (action === 'application.withdraw') {
      const user = await requireActiveUser(context);
      const applicationId = validateId(input && input.applicationId, '申请ID');
      const application = await store.withdrawApplication(applicationId, user.id, at);
      await store.addAudit({ id: operationId(context, 'audit'), actorId: user.id, action, targetType: 'application', targetId: applicationId, at });
      return { application: publicApplication(application) };
    }

    if (action === 'member.leave') {
      const user = await requireActiveUser(context);
      const activityId = validateId(input && input.activityId, '活动ID');
      const reason = stringValue(input && input.reason, '退出原因', { max: 120 });
      await moderation.check([reason], { actorId: user.id, scene: 2 });
      const result = await store.leaveActivity(activityId, user.id, reason, at);
      await store.addAudit({ id: operationId(context, 'audit'), actorId: user.id, action, targetType: 'activity', targetId: activityId, at });
      return { activity: publicActivity(result.activity, { role: 'member' }, at) };
    }

    if (action === 'ride.driver.accept') {
      const driverUser = await requireActiveUser(context);
      invariant(rideDriverAcceptanceEnabled, 'DRIVER_ACCEPTANCE_CLOSED');
      const payload = validateRideDriverAcceptInput(input);
      const result = await store.acceptRideAtomic({
        ...payload,
        driverId: driverUser.id,
        operationKeyHash: operationId(context, `rideAssignment:${payload.activityId}`),
        at
      });
      await store.addAudit({
        id: operationId(context, 'audit'),
        actorId: driverUser.id,
        action,
        targetType: 'rideFulfillment',
        targetId: payload.activityId,
        at
      });
      return {
        activity: publicActivity(result.activity, { role: 'driver' }, at),
        fulfillment: publicRideFulfillment(result.fulfillment)
      };
    }

    if (action === 'ride.driver.cancel') {
      const driverUser = await requireActiveUser(context);
      invariant(rideDriverAcceptanceEnabled, 'DRIVER_ACCEPTANCE_CLOSED');
      const payload = validateRideDriverCancelInput(input);
      await moderation.check([payload.reason], { actorId: driverUser.id, scene: 2 });
      const result = await store.cancelRideAssignmentAtomic({
        activityId: payload.activityId,
        driverId: driverUser.id,
        reason: payload.reason,
        at
      });
      await store.addAudit({
        id: operationId(context, 'audit'),
        actorId: driverUser.id,
        action,
        targetType: 'rideFulfillment',
        targetId: payload.activityId,
        at
      });
      return {
        activity: publicActivity(result.activity, { role: 'driver' }, at),
        fulfillment: publicRideFulfillment(result.fulfillment)
      };
    }

    if (action === 'activity.cancel') {
      const owner = await requireActiveUser(context);
      const activityId = validateId(input && input.activityId, '活动ID');
      const reason = stringValue(input && input.reason, '取消原因', { required: true, max: 120 });
      await moderation.check([reason], { actorId: owner.id, scene: 2 });
      const result = await store.cancelActivity(activityId, owner.id, reason, at);
      await store.addAudit({ id: operationId(context, 'audit'), actorId: owner.id, action, targetType: 'activity', targetId: activityId, at });
      return { activity: publicActivity(result.activity, { role: 'owner' }, at) };
    }

    if (action === 'activity.complete') {
      const owner = await requireActiveUser(context);
      const activityId = validateId(input && input.activityId, '活动ID');
      const activity = await store.completeActivity(activityId, owner.id, at);
      await store.addAudit({ id: operationId(context, 'audit'), actorId: owner.id, action, targetType: 'activity', targetId: activityId, at });
      return { activity: publicActivity(activity, { role: 'owner' }, at) };
    }

    if (action === 'group.contact') {
      const user = await requireActiveUser(context);
      const activityId = validateId(input && input.activityId, '活动ID');
      const contact = await store.getGroupContact(activityId, user.id);
      await store.addAudit({ id: idGenerator(), actorId: user.id, action: 'group.contact.view', targetType: 'activity', targetId: activityId, at });
      return contact;
    }

    if (action === 'application.listForOwner') {
      const owner = await requireActiveUser(context);
      const activityId = validateId(input && input.activityId, '活动ID');
      const items = await store.listApplicationsForOwner(activityId, owner.id);
      return { items: items.map(publicApplication) };
    }

    if (action === 'notification.list') {
      const user = await requireActiveUser(context, false);
      const items = await store.listNotifications(user.id);
      return { items: items.map(publicNotification) };
    }

    if (action === 'notification.read') {
      const user = await requireActiveUser(context, false);
      const notificationId = validateId(input && input.notificationId, '通知ID');
      const notification = await store.markNotificationRead(notificationId, user.id, at);
      return { notification: publicNotification(notification) };
    }

    if (action === 'report.create') {
      const user = await requireActiveUser(context);
      const payload = validateReportInput(input);
      await moderation.check([payload.description], { actorId: user.id, scene: 2 });
      const report = {
        id: stableEntityId('report', user.id, payload.targetType, payload.targetId),
        reporterId: user.id,
        ...payload,
        submissionKeyHash: operationId(context, 'submission'),
        status: 'NEW',
        createdAt: at,
        updatedAt: at
      };
      const storedReport = await store.createReport(report);
      await store.addAudit({ id: operationId(context, 'audit'), actorId: user.id, action, targetType: payload.targetType, targetId: payload.targetId, at });
      return {
        report: {
          id: storedReport.id,
          targetType: storedReport.targetType,
          targetId: storedReport.targetId,
          reason: storedReport.reason,
          description: storedReport.description,
          status: storedReport.status,
          createdAt: storedReport.createdAt
        },
        hiddenForReporter: true
      };
    }

    if (action === 'admin.activity.suspend') {
      const admin = await requireActiveUser(context, false);
      invariant(admin.role === 'admin', 'FORBIDDEN');
      const activityId = validateId(input && input.activityId, '活动ID');
      const reason = stringValue(input && input.reason, '处置原因', { required: true, max: 160 });
      const activity = await store.suspendActivity(activityId, admin.id, reason, at);
      await store.addAudit({ id: operationId(context, 'audit'), actorId: admin.id, action, targetType: 'activity', targetId: activityId, at });
      return { activity: publicActivity(activity, { role: 'admin' }, at) };
    }

    throw new AppError('NOT_FOUND', '接口动作不存在');
  }

  async function execute(event = {}, context = {}) {
    const requestId = event.requestId || idGenerator();
    try {
      const action = stringValue(event.action, 'action', { required: true, max: 80 });
      const input = event.data || {};
      let data;
      if (MUTATING_ACTIONS.has(action)) {
        // Account status is checked before idempotency replay so a user disabled
        // after an earlier success cannot keep replaying privileged results.
        await requireActiveUser(context, false);
        const actorId = requireActor(context);
        const key = requireIdempotencyKey(event.idempotencyKey);
        const cached = BUSINESS_IDEMPOTENT_ACTIONS.has(action) ? null : await store.getIdempotency(actorId, action, key);
        if (cached) return { ok: true, data: cached, requestId, idempotentReplay: true };
        data = await runAction(action, input, { ...context, idempotencyKey: key });
        if (!BUSINESS_IDEMPOTENT_ACTIONS.has(action)) await store.saveIdempotency(actorId, action, key, data, nowIso());
      } else {
        data = await runAction(action, input, context);
      }
      return { ok: true, data, requestId };
    } catch (error) {
      if (!(error instanceof AppError)) {
        // Keep diagnostics in server logs without exposing details to clients.
        console.error('[pinba-api]', requestId, error && error.stack ? error.stack : error);
      }
      return { ok: false, error: toPublicError(error), requestId };
    }
  }

  return { execute };
}

module.exports = {
  createPinbaService,
  publicActivity,
  publicApplication,
  publicActivityQuestion,
  publicRideFulfillment,
  publicDriverProfile,
  publicNotification,
  selfUser,
  publicDriverApplication
};
