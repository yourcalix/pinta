'use strict';

const { AppError, invariant } = require('./errors');
const { ACTIVITY_STATUS, APPLICATION_STATUS, MEMBER_STATUS } = require('./constants');
const { stableEntityId } = require('./ids');
const { collectPublicActivityPage } = require('./public-activity-page');

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

class MemoryStore {
  constructor(seed = {}) {
    this.users = new Map((seed.users || []).map((item) => [item.id, clone(item)]));
    this.activities = new Map((seed.activities || []).map((item) => [item.id, clone(item)]));
    this.applications = new Map((seed.applications || []).map((item) => [item.id, clone(item)]));
    this.members = new Map((seed.members || []).map((item) => [item.id, clone(item)]));
    this.notifications = new Map((seed.notifications || []).map((item) => [item.id, clone(item)]));
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

  async createActivityWithOwner(activity, ownerMember) {
    const existing = this.activities.get(activity.id);
    if (existing) {
      invariant(existing.operationKeyHash === activity.operationKeyHash, 'CONFLICT', '幂等键已用于其他活动');
      return clone(existing);
    }
    this.activities.set(activity.id, clone(activity));
    this.members.set(ownerMember.id, clone(ownerMember));
    return clone(activity);
  }

  async getActivity(activityId) {
    return clone(this.activities.get(activityId) || null);
  }

  async listActivities(filters = {}, at) {
    const allowedPublicStatuses = filters.status
      ? [filters.status]
      : [ACTIVITY_STATUS.RECRUITING, ACTIVITY_STATUS.FORMED];
    let candidates = [...this.activities.values()].filter((activity) => allowedPublicStatuses.includes(activity.status));
    if (filters.type) candidates = candidates.filter((activity) => activity.type === filters.type);
    if (filters.city) candidates = candidates.filter((activity) => activity.city === filters.city);
    if (filters.district) candidates = candidates.filter((activity) => activity.district === filters.district);
    candidates.sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
    const page = await collectPublicActivityPage({
      offset: filters.cursor || 0,
      limit: filters.limit,
      keyword: filters.keyword,
      at,
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

  async listUserActivities(actorId) {
    const owned = [...this.activities.values()].filter((item) => item.ownerId === actorId);
    const joinedIds = new Set(
      [...this.members.values()]
        .filter((item) => item.userId === actorId && item.role !== 'OWNER' && item.status === MEMBER_STATUS.ACTIVE)
        .map((item) => item.activityId)
    );
    const joined = [...joinedIds].map((id) => this.activities.get(id)).filter(Boolean);
    return clone({ owned, joined });
  }

  async createApplication(application) {
    const activity = this.activities.get(application.activityId);
    invariant(activity, 'NOT_FOUND');
    invariant(activity.status === ACTIVITY_STATUS.RECRUITING, 'CONFLICT', '该活动当前不可申请');
    invariant(activity.ownerId !== application.applicantId, 'CONFLICT', '不能申请自己发布的活动');
    invariant(Date.parse(activity.deadlineAt) > Date.parse(application.createdAt), 'CONFLICT', '该活动报名已截止');
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

    if (application.status === APPLICATION_STATUS.APPROVED) {
      const existingMember = [...this.members.values()].find(
        (item) => item.activityId === activityId && item.userId === application.applicantId && item.status === MEMBER_STATUS.ACTIVE
      );
      return clone({ activity, application, member: existingMember, cancelledApplicantIds: [] });
    }

    invariant(activity.status === ACTIVITY_STATUS.RECRUITING, 'CONFLICT', '活动当前不可继续批准成员');
    invariant(application.status === APPLICATION_STATUS.PENDING, 'CONFLICT', '该申请已处理');
    if (activity.memberCount >= activity.targetMembers) throw new AppError('CAPACITY_FULL');

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
    activity.version += 1;
    activity.updatedAt = at;

    const cancelledApplicantIds = [];
    if (activity.memberCount >= activity.targetMembers) {
      activity.status = ACTIVITY_STATUS.FORMED;
      activity.formedAt = at;
      for (const item of this.applications.values()) {
        if (item.activityId === activityId && item.status === APPLICATION_STATUS.PENDING) {
          item.status = APPLICATION_STATUS.CANCELLED_BY_ACTIVITY;
          item.updatedAt = at;
          cancelledApplicantIds.push(item.applicantId);
        }
      }
    }
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
    invariant(activity.ownerId !== actorId, 'FORBIDDEN', '发起者不能退团，请取消活动');
    const member = [...this.members.values()].find(
      (item) => item.activityId === activityId && item.userId === actorId && item.status === MEMBER_STATUS.ACTIVE
    );
    if (!member) {
      const leftMember = [...this.members.values()].find(
        (item) => item.activityId === activityId && item.userId === actorId && item.status === MEMBER_STATUS.LEFT
      );
      invariant(leftMember, 'NOT_FOUND', '你不是该活动的有效成员');
      return clone({ activity, member: leftMember });
    }
    invariant([ACTIVITY_STATUS.RECRUITING, ACTIVITY_STATUS.FORMED].includes(activity.status), 'CONFLICT', '活动当前不能退团');
    member.status = MEMBER_STATUS.LEFT;
    member.leftAt = at;
    member.leaveReason = reason;
    activity.memberCount = Math.max(1, activity.memberCount - 1);
    activity.version += 1;
    activity.updatedAt = at;
    if (activity.status === ACTIVITY_STATUS.FORMED) {
      activity.status = ACTIVITY_STATUS.RECRUITING;
      delete activity.formedAt;
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
