'use strict';

const crypto = require('crypto');
const { AppError, invariant, toPublicError } = require('./errors');
const { stableEntityId } = require('./ids');
const { ACTIVITY_STATUS, APPLICATION_STATUS } = require('./constants');
const {
  validateActivityInput,
  validateApplicationInput,
  validateProfileInput,
  validateReportInput,
  validateId,
  requireIdempotencyKey,
  stringValue
} = require('./validation');
const { createLocalModeration } = require('./moderation');

const MUTATING_ACTIONS = new Set([
  'profile.update',
  'activity.create',
  'activity.cancel',
  'activity.complete',
  'application.submit',
  'application.approve',
  'application.reject',
  'application.withdraw',
  'member.leave',
  'notification.read',
  'report.create',
  'admin.activity.suspend'
]);

function publicUser(user) {
  if (!user) return null;
  return {
    role: user.role,
    status: user.status,
    profile: user.profile
      ? {
          nickname: user.profile.nickname,
          city: user.profile.city,
          interests: user.profile.interests || [],
          adultConfirmed: user.profile.adultConfirmed === true
        }
      : null
  };
}

function publicActivity(activity, viewer = {}) {
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
    memberCount: activity.memberCount,
    status: activity.status,
    rules: activity.rules,
    typeData: activity.typeData,
    owner: activity.owner && activity.owner.nickname
      ? { nickname: activity.owner.nickname }
      : null,
    createdAt: activity.createdAt,
    updatedAt: activity.updatedAt
  };
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
      joinedAt: viewer.member.joinedAt
    };
  }
  result.viewerRole = viewer.role || 'guest';
  return result;
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
    activityId: notification.activityId,
    title: notification.title,
    read: notification.read === true,
    createdAt: notification.createdAt,
    readAt: notification.readAt
  };
}

function createPinbaService(options) {
  const store = options && options.store;
  invariant(store, 'INTERNAL', 'Store 未配置');
  const moderation = options.moderation || createLocalModeration();
  const clock = options.clock || (() => new Date());
  const idGenerator = options.idGenerator || (() => crypto.randomUUID());

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

  async function requireActiveUser(context, requireProfile = true) {
    const actorId = requireActor(context);
    const user = await store.getUser(actorId);
    invariant(user && user.status === 'ACTIVE', 'UNAUTHENTICATED');
    if (requireProfile) invariant(user.profile && user.profile.adultConfirmed === true, 'PROFILE_INCOMPLETE');
    return user;
  }

  async function runAction(action, input, context) {
    const at = nowIso();

    if (action === 'auth.login') {
      const actorId = requireActor(context);
      const user = await store.ensureUser(actorId, at);
      return { user: publicUser(user), sessionScope: stableEntityId('session', actorId) };
    }

    if (action === 'profile.get') {
      const actorId = requireActor(context);
      return { user: publicUser(await store.getUser(actorId)) };
    }

    if (action === 'profile.update') {
      const actorId = requireActor(context);
      await store.ensureUser(actorId, at);
      const profile = validateProfileInput(input);
      const user = await store.updateProfile(actorId, profile, at);
      await store.addAudit({ id: operationId(context, 'audit'), actorId, action, targetType: 'user', targetId: actorId, at });
      return { user: publicUser(user) };
    }

    if (action === 'activity.list') {
      const filters = {
        type: input && input.type,
        city: input && input.city,
        district: input && input.district,
        keyword: input && stringValue(input.keyword, '搜索词', { max: 30 }),
        cursor: input && input.cursor,
        limit: Math.min(Math.max(Number(input && input.limit) || 20, 1), 50)
      };
      const page = await store.listActivities(filters, at);
      return {
        items: page.items.map((item) => publicActivity(item)),
        nextCursor: page.nextCursor || null
      };
    }

    if (action === 'activity.detail') {
      const activityId = validateId(input && input.activityId, '活动ID');
      const activity = await store.getActivity(activityId);
      invariant(activity && activity.status !== ACTIVITY_STATUS.SUSPENDED, 'NOT_FOUND');
      const actorId = context && context.actorId;
      const viewer = actorId ? await store.getViewerContext(activityId, actorId) : {};
      return { activity: publicActivity(activity, viewer) };
    }

    if (action === 'activity.mine') {
      const user = await requireActiveUser(context, false);
      const result = await store.listUserActivities(user.id);
      return {
        owned: result.owned.map((item) => publicActivity(item, { role: 'owner' })),
        joined: result.joined.map((item) => publicActivity(item, { role: 'member' }))
      };
    }

    if (action === 'activity.create') {
      const user = await requireActiveUser(context);
      const payload = validateActivityInput(input, clock());
      await moderation.check([payload.title, payload.description, payload.rules], { actorId: user.id, scene: 2 });
      const activityId = operationId(context, 'activity');
      const activity = {
        id: activityId,
        ownerId: user.id,
        owner: { nickname: user.profile.nickname },
        ...payload,
        memberCount: 1,
        status: payload.targetMembers === 1 ? ACTIVITY_STATUS.FORMED : ACTIVITY_STATUS.RECRUITING,
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
        joinedAt: at
      };
      const storedActivity = await store.createActivityWithOwner(activity, ownerMember);
      await store.addAudit({ id: operationId(context, 'audit'), actorId: user.id, action, targetType: 'activity', targetId: activityId, at });
      return { activity: publicActivity(storedActivity, { role: 'owner' }) };
    }

    if (action === 'application.submit') {
      const user = await requireActiveUser(context);
      const payload = validateApplicationInput(input);
      await moderation.check([payload.note], { actorId: user.id, scene: 2 });
      const activity = await store.getActivity(payload.activityId);
      invariant(activity, 'NOT_FOUND');
      invariant(activity.status === ACTIVITY_STATUS.RECRUITING, 'CONFLICT', '该活动当前不可申请');
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
      await store.addNotification({
        id: operationId(context, 'notification'),
        userId: result.application.applicantId,
        type: result.activity.status === ACTIVITY_STATUS.FORMED ? 'GROUP_FORMED' : 'APPLICATION_APPROVED',
        activityId,
        title: result.activity.status === ACTIVITY_STATUS.FORMED ? `“${result.activity.title}”已成团` : `你已加入“${result.activity.title}”`,
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
        activity: publicActivity(result.activity, { role: 'owner' }),
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
        activity: publicActivity(result.activity, { role: 'owner' }),
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
      return { activity: publicActivity(result.activity, { role: 'member' }) };
    }

    if (action === 'activity.cancel') {
      const owner = await requireActiveUser(context);
      const activityId = validateId(input && input.activityId, '活动ID');
      const reason = stringValue(input && input.reason, '取消原因', { required: true, max: 120 });
      await moderation.check([reason], { actorId: owner.id, scene: 2 });
      const result = await store.cancelActivity(activityId, owner.id, reason, at);
      await store.addAudit({ id: operationId(context, 'audit'), actorId: owner.id, action, targetType: 'activity', targetId: activityId, at });
      return { activity: publicActivity(result.activity, { role: 'owner' }) };
    }

    if (action === 'activity.complete') {
      const owner = await requireActiveUser(context);
      const activityId = validateId(input && input.activityId, '活动ID');
      const activity = await store.completeActivity(activityId, owner.id, at);
      await store.addAudit({ id: operationId(context, 'audit'), actorId: owner.id, action, targetType: 'activity', targetId: activityId, at });
      return { activity: publicActivity(activity, { role: 'owner' }) };
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
      return { activity: publicActivity(activity, { role: 'admin' }) };
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
        const actorId = requireActor(context);
        const key = requireIdempotencyKey(event.idempotencyKey);
        const cached = await store.getIdempotency(actorId, action, key);
        if (cached) return { ok: true, data: cached, requestId, idempotentReplay: true };
        data = await runAction(action, input, { ...context, idempotencyKey: key });
        await store.saveIdempotency(actorId, action, key, data, nowIso());
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
  publicNotification,
  publicUser
};
