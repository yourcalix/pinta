'use strict';

const crypto = require('crypto');
const { AppError, invariant } = require('./errors');
const { ACTIVITY_STATUS, APPLICATION_STATUS, MEMBER_STATUS } = require('./constants');
const { stableEntityId } = require('./ids');
const { collectPublicActivityPage } = require('./public-activity-page');

function entity(data) {
  if (!data) return null;
  const { _id, ...rest } = data;
  return { id: _id, ...rest };
}

function document(value) {
  const { id, ...rest } = value;
  return rest;
}

function first(result) {
  if (!result || !result.data) return null;
  if (Array.isArray(result.data)) return result.data.length ? entity(result.data[0]) : null;
  return entity(result.data);
}

class CloudStore {
  constructor(cloud) {
    this.cloud = cloud;
    this.db = cloud.database();
    this.command = this.db.command;
  }

  async getDocument(collection, id) {
    try {
      const result = await this.db.collection(collection).doc(id).get();
      return first(result);
    } catch (error) {
      if (/not exist|not found/i.test(String(error && error.message))) return null;
      throw error;
    }
  }

  async ensureUser(actorId, at) {
    const current = await this.getUser(actorId);
    if (current) return current;
    const user = { id: actorId, role: 'user', status: 'ACTIVE', profile: null, createdAt: at, updatedAt: at };
    try {
      await this.db.collection('users').doc(actorId).set({ data: document(user) });
    } catch (error) {
      const concurrent = await this.getUser(actorId);
      if (concurrent) return concurrent;
      throw error;
    }
    return user;
  }

  async getUser(actorId) {
    return this.getDocument('users', actorId);
  }

  async updateProfile(actorId, profile, at) {
    await this.db.collection('users').doc(actorId).update({ data: { profile, updatedAt: at } });
    return this.getUser(actorId);
  }

  async createActivityWithOwner(activity, ownerMember) {
    return this.db.runTransaction(async (transaction) => {
      const existing = first(await transaction.collection('activities').doc(activity.id).get());
      if (existing) {
        invariant(existing.operationKeyHash === activity.operationKeyHash, 'CONFLICT', '幂等键已用于其他活动');
        return existing;
      }
      await transaction.collection('activities').doc(activity.id).set({ data: document(activity) });
      await transaction.collection('members').doc(ownerMember.id).set({ data: document(ownerMember) });
      return activity;
    });
  }

  async getActivity(activityId) {
    return this.getDocument('activities', activityId);
  }

  async listActivities(filters = {}, at) {
    const where = {
      status: filters.status || this.command.in([ACTIVITY_STATUS.RECRUITING, ACTIVITY_STATUS.FORMED])
    };
    if (filters.type) where.type = filters.type;
    if (filters.city) where.city = filters.city;
    if (filters.district) where.district = filters.district;
    return collectPublicActivityPage({
      offset: filters.cursor || 0,
      limit: filters.limit,
      keyword: filters.keyword,
      at,
      fetchBatch: async (offset, size) => {
        const result = await this.db.collection('activities')
          .where(where)
          .orderBy('startsAt', 'asc')
          .skip(offset)
          .limit(size)
          .get();
        return (result.data || []).map(entity);
      }
    });
  }

  async findOne(collection, where) {
    return first(await this.db.collection(collection).where(where).limit(1).get());
  }

  async getViewerContext(activityId, actorId) {
    const activity = await this.getActivity(activityId);
    if (!activity) return {};
    const applicationResult = await this.db.collection('applications')
      .where({ activityId, applicantId: actorId })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    const application = first(applicationResult);
    const member = await this.findOne('members', { activityId, userId: actorId, status: MEMBER_STATUS.ACTIVE });
    return {
      application,
      member,
      role: activity.ownerId === actorId ? 'owner' : member ? 'member' : application ? 'applicant' : 'guest'
    };
  }

  async listUserActivities(actorId) {
    const ownedResult = await this.db.collection('activities').where({ ownerId: actorId }).orderBy('updatedAt', 'desc').limit(100).get();
    const memberResult = await this.db.collection('members')
      .where({ userId: actorId, role: 'MEMBER', status: MEMBER_STATUS.ACTIVE })
      .limit(100)
      .get();
    const ids = (memberResult.data || []).map((item) => item.activityId);
    let joined = [];
    if (ids.length) {
      const joinedResult = await this.db.collection('activities').where({ _id: this.command.in(ids) }).limit(100).get();
      joined = (joinedResult.data || []).map(entity);
    }
    return { owned: (ownedResult.data || []).map(entity), joined };
  }

  async listActivityQuestions(activityId, options = {}) {
    const cursor = Number(options.cursor) || 0;
    const limit = Math.min(Math.max(Number(options.limit) || 10, 1), 10);
    const result = await this.db.collection('activityQuestions')
      .where({ activityId })
      .orderBy('createdAt', 'desc')
      .skip(cursor)
      .limit(limit + 1)
      .get();
    const items = (result.data || []).map(entity);
    return {
      items: items.slice(0, limit),
      nextCursor: items.length > limit ? String(cursor + limit) : null
    };
  }

  async createActivityQuestion(question, audit) {
    return this.db.runTransaction(async (transaction) => {
      const activity = first(await transaction.collection('activities').doc(question.activityId).get());
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
      const existing = first(await transaction.collection('activityQuestions').doc(question.id).get());
      if (existing) {
        invariant(existing.submissionKeyHash === question.submissionKeyHash, 'CONFLICT', '幂等键已用于其他问题');
        if (audit) await transaction.collection('auditLogs').doc(audit.id).set({ data: document(audit) });
        return existing;
      }
      await transaction.collection('activityQuestions').doc(question.id).set({ data: document(question) });
      if (audit) await transaction.collection('auditLogs').doc(audit.id).set({ data: document(audit) });
      return question;
    });
  }

  async answerActivityQuestionAtomic({ activityId, questionId, ownerId, answer, audit, at }) {
    return this.db.runTransaction(async (transaction) => {
      const activity = first(await transaction.collection('activities').doc(activityId).get());
      const question = first(await transaction.collection('activityQuestions').doc(questionId).get());
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
          if (audit) await transaction.collection('auditLogs').doc(audit.id).set({ data: document(audit) });
          return question;
        }
        throw new AppError('CONFLICT', '该问题已经回答');
      }
      await transaction.collection('activityQuestions').doc(questionId).update({
        data: { answer: document(answer), updatedAt: at }
      });
      if (audit) await transaction.collection('auditLogs').doc(audit.id).set({ data: document(audit) });
      return { ...question, answer, updatedAt: at };
    });
  }

  async createApplication(application) {
    return this.db.runTransaction(async (transaction) => {
      const activity = first(await transaction.collection('activities').doc(application.activityId).get());
      invariant(activity, 'NOT_FOUND');
      invariant(activity.status === ACTIVITY_STATUS.RECRUITING, 'CONFLICT', '该活动当前不可申请');
      invariant(activity.ownerId !== application.applicantId, 'CONFLICT', '不能申请自己发布的活动');
      invariant(Date.parse(activity.deadlineAt) > Date.parse(application.createdAt), 'CONFLICT', '该活动报名已截止');

      const duplicateResult = await transaction.collection('applications').doc(application.id).get();
      const duplicate = first(duplicateResult);
      if (duplicate && duplicate.submissionKeyHash === application.submissionKeyHash) return duplicate;
      invariant(
        !duplicate || ![APPLICATION_STATUS.PENDING, APPLICATION_STATUS.APPROVED].includes(duplicate.status),
        'CONFLICT',
        '你已经申请或加入该活动'
      );
      const memberId = stableEntityId('member', application.activityId, application.applicantId);
      const member = first(await transaction.collection('members').doc(memberId).get());
      invariant(!member || member.status !== MEMBER_STATUS.ACTIVE, 'CONFLICT', '你已经是该活动成员');
      await transaction.collection('applications').doc(application.id).set({ data: document(application) });
      return application;
    });
  }

  async approveApplicationAtomic({ activityId, applicationId, ownerId, at }) {
    const result = await this.db.runTransaction(async (transaction) => {
      const activity = first(await transaction.collection('activities').doc(activityId).get());
      const application = first(await transaction.collection('applications').doc(applicationId).get());
      invariant(activity && application && application.activityId === activityId, 'NOT_FOUND');
      invariant(activity.ownerId === ownerId, 'FORBIDDEN');
      const stableMemberId = stableEntityId('member', activityId, application.applicantId);
      if (application.status === APPLICATION_STATUS.APPROVED) {
        const existingMember = first(await transaction.collection('members').doc(stableMemberId).get());
        return { activity, application, member: existingMember, cancelledApplicantIds: [] };
      }
      invariant(activity.status === ACTIVITY_STATUS.RECRUITING, 'CONFLICT', '活动当前不可继续批准成员');
      invariant(application.status === APPLICATION_STATUS.PENDING, 'CONFLICT', '该申请已处理');
      if (activity.memberCount >= activity.targetMembers) throw new AppError('CAPACITY_FULL');

      const duplicateMember = first(await transaction.collection('members').doc(stableMemberId).get());
      invariant(!duplicateMember || duplicateMember.status !== MEMBER_STATUS.ACTIVE, 'CONFLICT', '申请人已经是活动成员');

      const nextCount = activity.memberCount + 1;
      const formed = nextCount >= activity.targetMembers;
      const nextActivity = {
        ...activity,
        memberCount: nextCount,
        status: formed ? ACTIVITY_STATUS.FORMED : activity.status,
        formedAt: formed ? at : activity.formedAt,
        version: activity.version + 1,
        updatedAt: at
      };
      const nextApplication = { ...application, status: APPLICATION_STATUS.APPROVED, approvedAt: at, updatedAt: at };
      const member = {
        id: stableMemberId,
        activityId,
        userId: application.applicantId,
        role: 'MEMBER',
        status: MEMBER_STATUS.ACTIVE,
        joinedAt: at
      };
      await transaction.collection('activities').doc(activityId).update({
        data: {
          memberCount: nextCount,
          status: nextActivity.status,
          formedAt: nextActivity.formedAt || this.command.remove(),
          version: nextActivity.version,
          updatedAt: at
        }
      });
      await transaction.collection('applications').doc(applicationId).update({
        data: { status: APPLICATION_STATUS.APPROVED, approvedAt: at, updatedAt: at }
      });
      await transaction.collection('members').doc(stableMemberId).set({ data: document(member) });

      return { activity: nextActivity, application: nextApplication, member, cancelledApplicantIds: [] };
    });
    if (result.activity.status === ACTIVITY_STATUS.FORMED) {
      result.cancelledApplicantIds = await this.closePendingApplications(activityId, at);
    }
    return result;
  }

  async closePendingApplications(activityId, at) {
    const cancelledApplicantIds = [];
    while (true) {
      const pending = await this.db.collection('applications').where({
        activityId,
        status: APPLICATION_STATUS.PENDING
      }).limit(100).get();
      const items = pending.data || [];
      if (!items.length) break;
      await Promise.all(items.map((item) => this.db.collection('applications').doc(item._id).update({
        data: { status: APPLICATION_STATUS.CANCELLED_BY_ACTIVITY, updatedAt: at }
      })));
      cancelledApplicantIds.push(...items.map((item) => item.applicantId));
    }
    return cancelledApplicantIds;
  }

  async rejectApplication(applicationId, ownerId, at) {
    return this.db.runTransaction(async (transaction) => {
      const application = first(await transaction.collection('applications').doc(applicationId).get());
      invariant(application, 'NOT_FOUND');
      const activity = first(await transaction.collection('activities').doc(application.activityId).get());
      invariant(activity && activity.ownerId === ownerId, 'FORBIDDEN');
      if (application.status === APPLICATION_STATUS.REJECTED) return { activity, application };
      invariant(application.status === APPLICATION_STATUS.PENDING, 'CONFLICT', '该申请已处理');
      const nextApplication = { ...application, status: APPLICATION_STATUS.REJECTED, updatedAt: at };
      await transaction.collection('applications').doc(applicationId).update({
        data: { status: APPLICATION_STATUS.REJECTED, updatedAt: at }
      });
      return { activity, application: nextApplication };
    });
  }

  async withdrawApplication(applicationId, actorId, at) {
    return this.db.runTransaction(async (transaction) => {
      const application = first(await transaction.collection('applications').doc(applicationId).get());
      invariant(application, 'NOT_FOUND');
      invariant(application.applicantId === actorId, 'FORBIDDEN');
      if (application.status === APPLICATION_STATUS.WITHDRAWN) return application;
      invariant(application.status === APPLICATION_STATUS.PENDING, 'CONFLICT', '当前状态不能撤回申请');
      const nextApplication = { ...application, status: APPLICATION_STATUS.WITHDRAWN, updatedAt: at };
      await transaction.collection('applications').doc(applicationId).update({
        data: { status: APPLICATION_STATUS.WITHDRAWN, updatedAt: at }
      });
      return nextApplication;
    });
  }

  async leaveActivity(activityId, actorId, reason, at) {
    return this.db.runTransaction(async (transaction) => {
      const activity = first(await transaction.collection('activities').doc(activityId).get());
      invariant(activity, 'NOT_FOUND');
      invariant(activity.ownerId !== actorId, 'FORBIDDEN', '发起者不能退团，请取消活动');
      const memberId = stableEntityId('member', activityId, actorId);
      const member = first(await transaction.collection('members').doc(memberId).get());
      if (!member) {
        throw new AppError('NOT_FOUND', '你不是该活动的有效成员');
      }
      if (member.status === MEMBER_STATUS.LEFT) return { activity, member };
      invariant(member.status === MEMBER_STATUS.ACTIVE, 'NOT_FOUND', '你不是该活动的有效成员');
      invariant([ACTIVITY_STATUS.RECRUITING, ACTIVITY_STATUS.FORMED].includes(activity.status), 'CONFLICT', '活动当前不能退团');
      const nextStatus = activity.status === ACTIVITY_STATUS.FORMED ? ACTIVITY_STATUS.RECRUITING : activity.status;
      await transaction.collection('members').doc(member.id).update({
        data: { status: MEMBER_STATUS.LEFT, leftAt: at, leaveReason: reason }
      });
      await transaction.collection('activities').doc(activityId).update({
        data: {
          memberCount: Math.max(1, activity.memberCount - 1),
          status: nextStatus,
          formedAt: nextStatus === ACTIVITY_STATUS.RECRUITING ? this.command.remove() : activity.formedAt,
          version: activity.version + 1,
          updatedAt: at
        }
      });
      const applicationId = stableEntityId('application', activityId, actorId);
      const approved = first(await transaction.collection('applications').doc(applicationId).get());
      if (approved && approved.status === APPLICATION_STATUS.APPROVED) {
        await transaction.collection('applications').doc(applicationId).update({
          data: { status: APPLICATION_STATUS.LEFT, updatedAt: at }
        });
      }
      return {
        activity: { ...activity, memberCount: Math.max(1, activity.memberCount - 1), status: nextStatus, updatedAt: at },
        member: { ...member, status: MEMBER_STATUS.LEFT, leftAt: at, leaveReason: reason }
      };
    });
  }

  async cancelActivity(activityId, ownerId, reason, at) {
    const result = await this.db.runTransaction(async (transaction) => {
      const activity = first(await transaction.collection('activities').doc(activityId).get());
      invariant(activity, 'NOT_FOUND');
      invariant(activity.ownerId === ownerId, 'FORBIDDEN');
      if (activity.status === ACTIVITY_STATUS.CANCELLED) return { activity };
      invariant([ACTIVITY_STATUS.RECRUITING, ACTIVITY_STATUS.FORMED].includes(activity.status), 'CONFLICT', '当前状态不能取消活动');
      const nextActivity = {
        ...activity,
        status: ACTIVITY_STATUS.CANCELLED,
        cancelReason: reason,
        cancelledAt: at,
        updatedAt: at,
        version: activity.version + 1
      };
      await transaction.collection('activities').doc(activityId).update({
        data: {
          status: nextActivity.status,
          cancelReason: reason,
          cancelledAt: at,
          updatedAt: at,
          version: nextActivity.version
        }
      });
      return { activity: nextActivity };
    });
    await this.closePendingApplications(activityId, at);
    return result;
  }

  async completeActivity(activityId, ownerId, at) {
    return this.db.runTransaction(async (transaction) => {
      const activity = first(await transaction.collection('activities').doc(activityId).get());
      invariant(activity, 'NOT_FOUND');
      invariant(activity.ownerId === ownerId, 'FORBIDDEN');
      if (activity.status === ACTIVITY_STATUS.COMPLETED) return activity;
      invariant([ACTIVITY_STATUS.FORMED, ACTIVITY_STATUS.IN_PROGRESS].includes(activity.status), 'CONFLICT', '当前状态不能完成活动');
      const nextActivity = {
        ...activity,
        status: ACTIVITY_STATUS.COMPLETED,
        completedAt: at,
        updatedAt: at,
        version: activity.version + 1
      };
      await transaction.collection('activities').doc(activityId).update({
        data: { status: nextActivity.status, completedAt: at, updatedAt: at, version: nextActivity.version }
      });
      return nextActivity;
    });
  }

  async getGroupContact(activityId, actorId) {
    const activity = await this.getActivity(activityId);
    invariant(activity, 'NOT_FOUND');
    invariant([ACTIVITY_STATUS.FORMED, ACTIVITY_STATUS.IN_PROGRESS, ACTIVITY_STATUS.COMPLETED].includes(activity.status), 'CONFLICT', '活动成团后才能查看联系信息');
    const member = await this.findOne('members', { activityId, userId: actorId, status: MEMBER_STATUS.ACTIVE });
    invariant(member, 'FORBIDDEN');
    return {
      activityId,
      contactInfo: activity.contactInfo,
      meeting: { city: activity.city, district: activity.district, placeLabel: activity.placeLabel, note: activity.rules || '' }
    };
  }

  async listApplicationsForOwner(activityId, ownerId) {
    const activity = await this.getActivity(activityId);
    invariant(activity, 'NOT_FOUND');
    invariant(activity.ownerId === ownerId, 'FORBIDDEN');
    const result = await this.db.collection('applications').where({ activityId }).orderBy('createdAt', 'desc').limit(100).get();
    return (result.data || []).map(entity);
  }

  async addNotification(notification) {
    await this.db.collection('notifications').doc(notification.id).set({ data: document(notification) });
    return notification;
  }

  async listNotifications(userId) {
    const result = await this.db.collection('notifications').where({ userId }).orderBy('createdAt', 'desc').limit(100).get();
    return (result.data || []).map(entity);
  }

  async markNotificationRead(notificationId, userId, at) {
    const notification = await this.getDocument('notifications', notificationId);
    invariant(notification, 'NOT_FOUND');
    invariant(notification.userId === userId, 'FORBIDDEN');
    await this.db.collection('notifications').doc(notificationId).update({ data: { read: true, readAt: at } });
    return { ...notification, read: true, readAt: at };
  }

  async createReport(report) {
    return this.db.runTransaction(async (transaction) => {
      const existing = first(await transaction.collection('reports').doc(report.id).get());
      if (existing && existing.submissionKeyHash === report.submissionKeyHash) return existing;
      invariant(!existing || existing.status === 'CLOSED', 'CONFLICT', '你已经举报过该内容');
      await transaction.collection('reports').doc(report.id).set({ data: document(report) });
      return report;
    });
  }

  async suspendActivity(activityId, adminId, reason, at) {
    const activity = await this.getActivity(activityId);
    invariant(activity, 'NOT_FOUND');
    if (activity.status === ACTIVITY_STATUS.SUSPENDED) return activity;
    await this.db.collection('activities').doc(activityId).update({
      data: {
        status: ACTIVITY_STATUS.SUSPENDED,
        suspension: { adminId, reason, at },
        updatedAt: at,
        version: activity.version + 1
      }
    });
    return { ...activity, status: ACTIVITY_STATUS.SUSPENDED, suspension: { adminId, reason, at }, updatedAt: at };
  }

  async addAudit(audit) {
    await this.db.collection('auditLogs').doc(audit.id).set({ data: document(audit) });
    return audit;
  }

  idempotencyId(actorId, action, key) {
    return crypto.createHash('sha256').update(`${actorId}:${action}:${key}`).digest('hex');
  }

  async getIdempotency(actorId, action, key) {
    const record = await this.getDocument('idempotency', this.idempotencyId(actorId, action, key));
    return record ? record.result : null;
  }

  async saveIdempotency(actorId, action, key, result, at) {
    const id = this.idempotencyId(actorId, action, key);
    await this.db.collection('idempotency').doc(id).set({
      data: { actorId, action, keyHash: id, result, createdAt: at }
    });
    return { savedAt: at };
  }
}

module.exports = {
  CloudStore,
  entity,
  document
};
