'use strict';

const crypto = require('crypto');
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
  MACAU_RIDE_ROUTE_IDS_BY_CAMPUS
} = require('./constants');
const { stableEntityId } = require('./ids');
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

const CLOUD_IN_QUERY_CHUNK_SIZE = 10;
const DRIVER_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;

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

function isMissingDocumentError(error) {
  const message = String(error && (error.message || error.errMsg) || error);
  return Number(error && error.errCode) === -502005
    || /document .* does not exist/i.test(message)
    || /document_not_found/i.test(message);
}

async function getTransactionDocument(documentReference) {
  try {
    return first(await documentReference.get());
  } catch (error) {
    if (isMissingDocumentError(error)) return null;
    throw error;
  }
}

function isSupportedImage(buffer) {
  if (!Buffer.isBuffer(buffer)) return false;
  const jpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const png = buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return jpeg || png;
}

function isExactCloudFile(fileID, cloudPath) {
  const match = typeof fileID === 'string' && /^cloud:\/\/[^/]+\/(.+)$/.exec(fileID);
  return Boolean(match && match[1] === cloudPath);
}

function rideFulfillmentSummary(fulfillment) {
  if (!fulfillment) return null;
  return {
    status: fulfillment.status,
    pickupAt: fulfillment.pickupAt || null,
    assignedAt: fulfillment.assignedAt || null,
    ...(fulfillment.driver ? { driver: fulfillment.driver } : {}),
    ...(fulfillment.vehicle ? { vehicle: fulfillment.vehicle } : {})
  };
}

function isRideJoinable(activity, at) {
  return isRidePassengerJoinable(normalizeRideCapacity(activity), at);
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
    return this.db.runTransaction(async (transaction) => {
      const userDocument = transaction.collection('users').doc(actorId);
      const current = first(await userDocument.get());
      invariant(current, 'NOT_FOUND');
      const next = { ...current, profile, updatedAt: at };
      await userDocument.set({ data: document(next) });
      return next;
    });
  }

  async updateOnboardingRole(actorId, roleIntent, at) {
    await this.db.collection('users').doc(actorId).update({
      data: { onboarding: { roleIntent, completedAt: at }, updatedAt: at }
    });
    return this.getUser(actorId);
  }

  async getDriverApplication(userId) {
    return this.getDocument('driverApplications', userId);
  }

  async registerDriverDocumentUpload(upload) {
    await this.db.collection('driverDocumentUploads').doc(upload.id).set({ data: document(upload) });
    return upload;
  }

  async confirmDriverDocumentUpload({ userId, uploadId, kind, fileID, at }) {
    const upload = await this.getDocument('driverDocumentUploads', uploadId);
    invariant(upload && upload.userId === userId && upload.kind === kind && ['PREPARED', 'INSPECTED'].includes(upload.status), 'DRIVER_DOCUMENT_REQUIRED');
    invariant(Date.parse(upload.expiresAt) > Date.parse(at), 'DRIVER_DOCUMENT_REQUIRED', '上传凭据已过期');
    invariant(isExactCloudFile(fileID, upload.cloudPath), 'DRIVER_DOCUMENT_REQUIRED', '文件与上传凭据不匹配');
    if (upload.status === 'INSPECTED') return upload;
    let fileContent;
    try {
      const downloaded = await this.cloud.downloadFile({ fileID });
      fileContent = downloaded && downloaded.fileContent;
    } catch (error) {
      throw new AppError('DRIVER_DOCUMENT_REQUIRED', '认证图片读取失败，请重新上传');
    }
    invariant(Buffer.isBuffer(fileContent) && fileContent.length > 0, 'DRIVER_DOCUMENT_REQUIRED', '认证图片内容无效');
    invariant(fileContent.length <= DRIVER_DOCUMENT_MAX_BYTES, 'DRIVER_DOCUMENT_REQUIRED', '单张认证图片不能超过5MB');
    invariant(isSupportedImage(fileContent), 'DRIVER_DOCUMENT_REQUIRED', '认证资料仅支持 JPEG 或 PNG 图片');
    const inspectedAt = at;
    const sealedPath = `private-driver-sealed/${crypto.randomBytes(16).toString('hex')}.bin`;
    const sealedResult = await this.cloud.uploadFile({ cloudPath: sealedPath, fileContent });
    invariant(sealedResult && sealedResult.fileID, 'DRIVER_DOCUMENT_REQUIRED', '认证图片安全保存失败，请重试');
    let resolved;
    try {
      resolved = await this.db.runTransaction(async (transaction) => {
        const current = first(await transaction.collection('driverDocumentUploads').doc(uploadId).get());
        invariant(current && current.userId === userId && current.kind === kind, 'DRIVER_DOCUMENT_REQUIRED');
        if (current.status === 'INSPECTED') return current;
        invariant(current.status === 'PREPARED', 'DRIVER_DOCUMENT_REQUIRED');
        invariant(Date.parse(current.expiresAt) > Date.parse(at), 'DRIVER_DOCUMENT_REQUIRED', '上传凭据已过期');
        const next = {
          ...current,
          status: 'INSPECTED',
          sealedFileID: sealedResult.fileID,
          byteLength: fileContent.length,
          contentHash: crypto.createHash('sha256').update(fileContent).digest('hex'),
          inspectedAt,
          updatedAt: at
        };
        await transaction.collection('driverDocumentUploads').doc(uploadId).set({ data: document(next) });
        return next;
      });
    } finally {
      const redundantSealedFile = !resolved || resolved.sealedFileID !== sealedResult.fileID ? sealedResult.fileID : null;
      const cleanup = [fileID, redundantSealedFile].filter(Boolean);
      if (cleanup.length && typeof this.cloud.deleteFile === 'function') {
        try { await this.cloud.deleteFile({ fileList: cleanup }); } catch (error) { /* retention cleanup is a deployment backstop */ }
      }
    }
    return resolved;
  }

  async resolveDriverDocumentReferences(userId, documentRefs, at) {
    const result = {};
    for (const [kind, reference] of Object.entries(documentRefs)) {
      const upload = await this.getDocument('driverDocumentUploads', reference.uploadId);
      invariant(upload && upload.userId === userId && upload.kind === kind && upload.status === 'INSPECTED', 'DRIVER_DOCUMENT_REQUIRED');
      invariant(Date.parse(upload.expiresAt) > Date.parse(at), 'DRIVER_DOCUMENT_REQUIRED', '上传凭据已过期');
      invariant(upload.sealedFileID, 'DRIVER_DOCUMENT_REQUIRED', '认证图片尚未完成安全处理');
      result[kind] = { uploadId: upload.id, fileID: upload.sealedFileID };
    }
    return result;
  }

  async submitDriverApplication({ userId, application, secrets, documentRefs, autoApprove, audit }) {
    return this.db.runTransaction(async (transaction) => {
      const materializeApproval = async (approvedApplication) => {
        const facts = driverApprovalFacts(userId, approvedApplication, approvedApplication.updatedAt);
        await transaction.collection('drivers').doc(facts.driver.id).set({ data: document(facts.driver) });
        await transaction.collection('vehicles').doc(facts.vehicle.id).set({ data: document(facts.vehicle) });
      };
      const current = await getTransactionDocument(
        transaction.collection('driverApplications').doc(userId)
      );
      if (current && current.operationKeyHash === application.operationKeyHash) {
        invariant(current.payloadHash === application.payloadHash, 'CONFLICT', '幂等键已用于其他司机认证资料');
        if (autoApprove && current.status === 'APPROVED') await materializeApproval(current);
        return current;
      }
      invariant(!current || !['SUBMITTED', 'APPROVED'].includes(current.status), current && current.status === 'SUBMITTED' ? 'DRIVER_APPLICATION_PENDING' : 'DRIVER_APPLICATION_LOCKED');
      for (const [kind, reference] of Object.entries(documentRefs)) {
        const upload = first(await transaction.collection('driverDocumentUploads').doc(reference.uploadId).get());
        invariant(upload && upload.userId === userId && upload.kind === kind && upload.status === 'INSPECTED', 'DRIVER_DOCUMENT_REQUIRED');
        invariant(Date.parse(upload.expiresAt) > Date.parse(application.updatedAt), 'DRIVER_DOCUMENT_REQUIRED', '上传凭据已过期');
        invariant(reference.fileID === upload.sealedFileID, 'DRIVER_DOCUMENT_REQUIRED', '文件与上传凭据不匹配');
        await transaction.collection('driverDocumentUploads').doc(reference.uploadId).update({
          data: {
            status: 'BOUND', applicationRevision: application.revision,
            fileIDHash: application.documentFileHashes[kind], updatedAt: application.updatedAt
          }
        });
      }
      await transaction.collection('driverApplications').doc(userId).set({ data: document(application) });
      await transaction.collection('driverSecrets').doc(userId).set({
        data: document({ id: userId, userId, ...secrets, status: 'ACTIVE', retentionUntil: null, updatedAt: application.updatedAt })
      });
      if (autoApprove) await materializeApproval(application);
      if (audit) await transaction.collection('auditLogs').doc(audit.id).set({ data: document(audit) });
      return application;
    });
  }

  async ensureApprovedDriverFacts(userId, application, at) {
    invariant(application && application.status === 'APPROVED', 'DRIVER_APPLICATION_LOCKED');
    const facts = driverApprovalFacts(userId, application, at);
    return this.db.runTransaction(async (transaction) => {
      await transaction.collection('drivers').doc(facts.driver.id).set({ data: document(facts.driver) });
      await transaction.collection('vehicles').doc(facts.vehicle.id).set({ data: document(facts.vehicle) });
      return facts;
    });
  }

  async withdrawDriverApplication(userId, at, audit) {
    return this.db.runTransaction(async (transaction) => {
      const application = first(await transaction.collection('driverApplications').doc(userId).get());
      invariant(application, 'NOT_FOUND');
      invariant(['SUBMITTED', 'NEEDS_MORE_INFO'].includes(application.status), 'DRIVER_APPLICATION_LOCKED');
      const next = { ...application, status: 'WITHDRAWN', updatedAt: at };
      await transaction.collection('driverApplications').doc(userId).set({ data: document(next) });
      const retentionUntil = new Date(Date.parse(at) + 30 * 24 * 60 * 60 * 1000).toISOString();
      await transaction.collection('driverSecrets').doc(userId).update({ data: { status: 'RETENTION_PENDING', retentionUntil, updatedAt: at } });
      for (const uploadId of Object.values(application.documentUploadIds || {})) {
        await transaction.collection('driverDocumentUploads').doc(uploadId).update({ data: { status: 'RETENTION_PENDING', retentionUntil, updatedAt: at } });
      }
      if (audit) await transaction.collection('auditLogs').doc(audit.id).set({ data: document(audit) });
      return next;
    });
  }

  async reviewDriverApplication({ userId, reviewerId, decision, reasonCode, reviewPayloadHash, at, audit }) {
    return this.db.runTransaction(async (transaction) => {
      const application = first(await transaction.collection('driverApplications').doc(userId).get());
      if (application && application.reviewOperationKeyHash === audit.operationKeyHash) {
        invariant(application.reviewPayloadHash === reviewPayloadHash, 'CONFLICT', '幂等键已用于其他审核决定');
        return application;
      }
      invariant(application && ['SUBMITTED', 'NEEDS_MORE_INFO'].includes(application.status), 'DRIVER_APPLICATION_LOCKED');
      const next = {
        ...application,
        status: decision,
        review: { reviewerId, reasonCode: reasonCode || '', reviewedAt: at },
        reviewOperationKeyHash: audit.operationKeyHash,
        reviewPayloadHash,
        updatedAt: at
      };
      await transaction.collection('driverApplications').doc(userId).set({ data: document(next) });
      if (decision === 'APPROVED') {
        const facts = driverApprovalFacts(userId, next, at);
        await transaction.collection('drivers').doc(facts.driver.id).set({ data: document(facts.driver) });
        await transaction.collection('vehicles').doc(facts.vehicle.id).set({ data: document(facts.vehicle) });
      }
      if (['REJECTED', 'NEEDS_MORE_INFO'].includes(decision)) {
        const retentionUntil = new Date(Date.parse(at) + 30 * 24 * 60 * 60 * 1000).toISOString();
        await transaction.collection('driverSecrets').doc(userId).update({ data: { status: 'RETENTION_PENDING', retentionUntil, updatedAt: at } });
        for (const uploadId of Object.values(application.documentUploadIds || {})) {
          await transaction.collection('driverDocumentUploads').doc(uploadId).update({ data: { status: 'RETENTION_PENDING', retentionUntil, updatedAt: at } });
        }
      }
      if (audit) await transaction.collection('auditLogs').doc(audit.id).set({ data: document(audit) });
      return next;
    });
  }

  async createActivityWithOwner(activity, ownerMember, rideFulfillment = null) {
    if (activity.type === 'ride') {
      invariant(MEMBER_LUGGAGE_TYPES.includes(ownerMember.luggageType), 'VALIDATION_ERROR', '我的行李选项无效');
    }
    return this.db.runTransaction(async (transaction) => {
      const existing = await getTransactionDocument(
        transaction.collection('activities').doc(activity.id)
      );
      if (existing) {
        invariant(existing.operationKeyHash === activity.operationKeyHash, 'CONFLICT', '幂等键已用于其他活动');
        return existing;
      }
      await transaction.collection('activities').doc(activity.id).set({ data: document(activity) });
      await transaction.collection('members').doc(ownerMember.id).set({ data: document(ownerMember) });
      if (rideFulfillment) {
        await transaction.collection('rideFulfillments').doc(rideFulfillment.id).set({ data: document(rideFulfillment) });
      }
      return activity;
    });
  }

  async getActivity(activityId) {
    const activity = await this.getDocument('activities', activityId);
    if (!activity || activity.type !== 'ride') return activity;
    const fulfillment = await this.getDocument('rideFulfillments', stableEntityId('rideFulfillment', activityId));
    return { ...activity, rideFulfillment: rideFulfillmentSummary(fulfillment) };
  }

  async listActivities(filters = {}, at) {
    const hasRideLocationFilter = Boolean(filters.routeId || filters.campusId);
    if (hasRideLocationFilter && filters.type && filters.type !== 'ride') {
      return { items: [], nextCursor: null };
    }
    const where = {
      status: filters.status || this.command.in([ACTIVITY_STATUS.RECRUITING, ACTIVITY_STATUS.FORMED])
    };
    if (filters.type) where.type = filters.type;
    if (hasRideLocationFilter) where.type = 'ride';
    if (filters.viewMode === 'driver') {
      where.type = 'ride';
    }
    if (filters.city) where.city = filters.city;
    if (filters.district) where.district = filters.district;
    if (filters.campusId) {
      const campusRouteIds = MACAU_RIDE_ROUTE_IDS_BY_CAMPUS[filters.campusId] || [];
      if (filters.routeId && !campusRouteIds.includes(filters.routeId)) {
        return { items: [], nextCursor: null };
      }
      where['typeData.routeId'] = filters.routeId || this.command.in(campusRouteIds);
    } else if (filters.routeId) {
      where['typeData.routeId'] = filters.routeId;
    }
    return collectPublicActivityPage({
      offset: filters.cursor || 0,
      limit: filters.limit,
      keyword: filters.keyword,
      at,
      filterActivity: (activity) => filters.viewMode === 'driver'
        ? rideDriverAvailability(activity, at).acceptable
        : activity.type !== 'ride' || isRideJoinable(activity, at),
      fetchBatch: async (offset, size) => {
        const result = await this.db.collection('activities')
          .where(where)
          .orderBy('startsAt', 'asc')
          .skip(offset)
          .limit(size)
          .get();
        const activities = (result.data || []).map(entity);
        const rideIds = activities.filter((item) => item.type === 'ride').map((item) => item.id);
        if (!rideIds.length) return activities;
        const fulfillmentRows = [];
        for (let index = 0; index < rideIds.length; index += CLOUD_IN_QUERY_CHUNK_SIZE) {
          const chunk = rideIds.slice(index, index + CLOUD_IN_QUERY_CHUNK_SIZE);
          const fulfillmentResult = await this.db.collection('rideFulfillments')
            .where({ activityId: this.command.in(chunk) })
            .limit(chunk.length)
            .get();
          fulfillmentRows.push(...(fulfillmentResult.data || []));
        }
        const fulfillments = new Map(fulfillmentRows
          .map(entity)
          .map((item) => [item.activityId, item]));
        return activities.map((activity) => {
          if (activity.type !== 'ride') return activity;
          const fulfillment = fulfillments.get(activity.id);
          return {
            ...activity,
            rideFulfillment: fulfillment
              ? { status: fulfillment.status, pickupAt: fulfillment.pickupAt || null }
              : null
          };
        });
      }
    });
  }

  async findOne(collection, where) {
    return first(await this.db.collection(collection).where(where).limit(1).get());
  }

  async fetchActivitiesByIdsChunked(ids) {
    const rows = [];
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    for (let index = 0; index < uniqueIds.length; index += CLOUD_IN_QUERY_CHUNK_SIZE) {
      const chunk = uniqueIds.slice(index, index + CLOUD_IN_QUERY_CHUNK_SIZE);
      const result = await this.db.collection('activities')
        .where({ _id: this.command.in(chunk) })
        .limit(chunk.length)
        .get();
      rows.push(...(result.data || []).map(entity));
    }
    return rows;
  }

  async hydrateRideActivities(activities, at) {
    const rideIds = activities.filter((item) => item && item.type === 'ride').map((item) => item.id);
    if (!rideIds.length) return activities;
    const fulfillmentRows = [];
    for (let index = 0; index < rideIds.length; index += CLOUD_IN_QUERY_CHUNK_SIZE) {
      const chunk = rideIds.slice(index, index + CLOUD_IN_QUERY_CHUNK_SIZE);
      const result = await this.db.collection('rideFulfillments')
        .where({ activityId: this.command.in(chunk) })
        .limit(chunk.length)
        .get();
      fulfillmentRows.push(...(result.data || []).map(entity));
    }
    const fulfillments = new Map(fulfillmentRows.map((item) => [item.activityId, item]));
    return activities.map((activity) => {
      if (!activity || activity.type !== 'ride') return activity;
      const effectiveActivity = {
        ...activity,
        rideFulfillment: rideFulfillmentSummary(fulfillments.get(activity.id))
      };
      return { ...effectiveActivity, rideJoinable: isRideJoinable(effectiveActivity, at) };
    });
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
    const fulfillment = activity.type === 'ride' ? await this.getRideFulfillment(activityId) : null;
    return {
      application,
      member,
      role: activity.ownerId === actorId
        ? 'owner'
        : member
          ? 'member'
          : fulfillment && fulfillment.status === RIDE_FULFILLMENT_STATUS.ASSIGNED && fulfillment.driverId === actorId
            ? 'driver'
            : application ? 'applicant' : 'guest'
    };
  }

  async listUserActivities(actorId, at) {
    const ownedResult = await this.db.collection('activities').where({ ownerId: actorId }).orderBy('updatedAt', 'desc').limit(100).get();
    const memberResult = await this.db.collection('members')
      .where({ userId: actorId, role: 'MEMBER', status: MEMBER_STATUS.ACTIVE })
      .limit(100)
      .get();
    const ids = (memberResult.data || []).map((item) => item.activityId);
    const owned = (ownedResult.data || []).map(entity);
    const joined = ids.length ? await this.fetchActivitiesByIdsChunked(ids) : [];
    const hydrated = await this.hydrateRideActivities([...owned, ...joined], at);
    return { owned: hydrated.slice(0, owned.length), joined: hydrated.slice(owned.length) };
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
      const fulfillment = activity.type === 'ride'
        ? first(await transaction.collection('rideFulfillments').doc(stableEntityId('rideFulfillment', activity.id)).get())
        : null;
      const effectiveActivity = activity.type === 'ride'
        ? { ...activity, rideFulfillment: rideFulfillmentSummary(fulfillment) }
        : activity;
      const rideJoinable = isRideJoinable(effectiveActivity, application.createdAt);
      invariant(
        activity.type === 'ride' ? rideJoinable : activity.status === ACTIVITY_STATUS.RECRUITING,
        'CONFLICT',
        '该活动当前不可申请'
      );
      if (activity.memberCount >= (activity.type === 'ride' ? rideCapacity(activity) : (activity.maxPassengers || activity.targetMembers))) throw new AppError('CAPACITY_FULL');
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
      const fulfillment = activity.type === 'ride'
        ? first(await transaction.collection('rideFulfillments').doc(stableEntityId('rideFulfillment', activityId)).get())
        : null;
      const effectiveActivity = activity.type === 'ride'
        ? { ...activity, rideFulfillment: rideFulfillmentSummary(fulfillment) }
        : activity;
      const stableMemberId = stableEntityId('member', activityId, application.applicantId);
      if (application.status === APPLICATION_STATUS.APPROVED) {
        const existingMember = first(await transaction.collection('members').doc(stableMemberId).get());
        const capacity = effectiveActivity.type === 'ride'
          ? rideCapacity(effectiveActivity)
          : (effectiveActivity.maxPassengers || effectiveActivity.targetMembers);
        return {
          activity: effectiveActivity,
          application,
          member: existingMember,
          cancelledApplicantIds: [],
          reachedCapacity: effectiveActivity.memberCount >= capacity
        };
      }
      invariant(Date.parse(effectiveActivity.deadlineAt) > Date.parse(at), 'CONFLICT', '该活动报名已截止');
      if (effectiveActivity.type === 'ride' && effectiveActivity.status === ACTIVITY_STATUS.FORMED) {
        invariant(
          Date.parse(effectiveActivity.typeData && effectiveActivity.typeData.pickupWindowEnd) > Date.parse(at),
          'CONFLICT',
          '该行程接车时间窗已结束'
        );
      }
      const rideJoinable = isRideJoinable(effectiveActivity, at);
      invariant(
        effectiveActivity.type === 'ride' ? rideJoinable : effectiveActivity.status === ACTIVITY_STATUS.RECRUITING,
        'CONFLICT',
        '活动当前不可继续批准成员'
      );
      invariant(application.status === APPLICATION_STATUS.PENDING, 'CONFLICT', '该申请已处理');
      const capacity = effectiveActivity.type === 'ride'
        ? rideCapacity(effectiveActivity)
        : (effectiveActivity.maxPassengers || effectiveActivity.targetMembers);
      if (effectiveActivity.memberCount >= capacity) throw new AppError('CAPACITY_FULL');

      const duplicateMember = first(await transaction.collection('members').doc(stableMemberId).get());
      invariant(!duplicateMember || duplicateMember.status !== MEMBER_STATUS.ACTIVE, 'CONFLICT', '申请人已经是活动成员');

      const nextCount = effectiveActivity.memberCount + 1;
      const threshold = effectiveActivity.type === 'ride'
        ? rideThreshold(effectiveActivity)
        : (effectiveActivity.minPassengers || effectiveActivity.targetMembers);
      const formed = nextCount >= threshold;
      const reachedCapacity = nextCount >= capacity;
      const nextActivity = {
        ...effectiveActivity,
        memberCount: nextCount,
        status: formed ? ACTIVITY_STATUS.FORMED : effectiveActivity.status,
        formedAt: formed ? effectiveActivity.formedAt || at : effectiveActivity.formedAt,
        version: effectiveActivity.version + 1,
        updatedAt: at
      };
      if (effectiveActivity.type === 'ride') nextActivity.rideJoinable = !reachedCapacity && isRideJoinable(nextActivity, at);
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
          ...(effectiveActivity.type === 'ride'
            ? {
                rideFulfillment: nextActivity.rideFulfillment,
                rideJoinable: nextActivity.rideJoinable,
                targetMembers: threshold,
                minPassengers: threshold,
                maxPassengers: capacity
              }
            : {}),
          updatedAt: at
        }
      });
      await transaction.collection('applications').doc(applicationId).update({
        data: { status: APPLICATION_STATUS.APPROVED, approvedAt: at, updatedAt: at }
      });
      await transaction.collection('members').doc(stableMemberId).set({ data: document(member) });

      return { activity: nextActivity, application: nextApplication, member, cancelledApplicantIds: [], reachedCapacity };
    });
    if (result.reachedCapacity) {
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
      const fulfillment = activity.type === 'ride'
        ? first(await transaction.collection('rideFulfillments')
          .doc(stableEntityId('rideFulfillment', activityId)).get())
        : null;
      const effectiveActivity = activity.type === 'ride'
        ? { ...activity, rideFulfillment: rideFulfillmentSummary(fulfillment) }
        : activity;
      invariant(
        activity.type !== 'ride'
          || !effectiveActivity.rideFulfillment
          || effectiveActivity.rideFulfillment.status === RIDE_FULFILLMENT_STATUS.UNASSIGNED,
        'RIDE_MEMBER_LOCKED'
      );
      invariant(activity.ownerId !== actorId, 'FORBIDDEN', '发起者不能退团，请取消活动');
      const memberId = stableEntityId('member', activityId, actorId);
      const member = first(await transaction.collection('members').doc(memberId).get());
      if (!member) {
        throw new AppError('NOT_FOUND', '你不是该活动的有效成员');
      }
      if (member.status === MEMBER_STATUS.LEFT) return { activity: effectiveActivity, member };
      invariant(member.status === MEMBER_STATUS.ACTIVE, 'NOT_FOUND', '你不是该活动的有效成员');
      invariant([ACTIVITY_STATUS.RECRUITING, ACTIVITY_STATUS.FORMED].includes(activity.status), 'CONFLICT', '活动当前不能退团');
      const nextCount = Math.max(1, activity.memberCount - 1);
      const threshold = activity.type === 'ride'
        ? rideThreshold(activity)
        : (activity.minPassengers || activity.targetMembers);
      const nextStatus = activity.status === ACTIVITY_STATUS.FORMED && nextCount < threshold
        ? ACTIVITY_STATUS.RECRUITING
        : activity.status;
      const nextActivity = { ...effectiveActivity, memberCount: nextCount, status: nextStatus };
      const rideJoinable = activity.type === 'ride' && isRideJoinable(nextActivity, at);
      await transaction.collection('members').doc(member.id).update({
        data: { status: MEMBER_STATUS.LEFT, leftAt: at, leaveReason: reason }
      });
      await transaction.collection('activities').doc(activityId).update({
        data: {
          memberCount: nextCount,
          status: nextStatus,
          formedAt: nextStatus === ACTIVITY_STATUS.RECRUITING ? this.command.remove() : activity.formedAt,
          ...(activity.type === 'ride'
            ? { rideFulfillment: effectiveActivity.rideFulfillment, rideJoinable }
            : {}),
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
        activity: { ...nextActivity, rideJoinable, updatedAt: at },
        member: { ...member, status: MEMBER_STATUS.LEFT, leftAt: at, leaveReason: reason }
      };
    });
  }

  async joinRideAtomic({ activityId, actorId, luggageType, at }) {
    invariant(MEMBER_LUGGAGE_TYPES.includes(luggageType), 'VALIDATION_ERROR', '我的行李选项无效');
    return this.db.runTransaction(async (transaction) => {
      const activityRef = transaction.collection('activities').doc(activityId);
      const fulfillmentId = stableEntityId('rideFulfillment', activityId);
      const activity = await getTransactionDocument(activityRef);
      const fulfillment = await getTransactionDocument(transaction.collection('rideFulfillments').doc(fulfillmentId));
      invariant(activity && activity.type === 'ride' && fulfillment, 'NOT_FOUND');
      invariant(activity.ownerId !== actorId, 'CONFLICT', '发起者已经在行程中');
      invariant(fulfillment.driverId !== actorId, 'FORBIDDEN', '同一行程不能同时作为司机和乘客');
      const memberId = stableEntityId('member', activityId, actorId);
      const memberRef = transaction.collection('members').doc(memberId);
      const existing = await getTransactionDocument(memberRef);
      const applicationRef = transaction.collection('applications').doc(stableEntityId('application', activityId, actorId));
      const application = await getTransactionDocument(applicationRef);
      const rideFulfillment = rideFulfillmentSummary(fulfillment);
      if (existing && existing.status === MEMBER_STATUS.ACTIVE) {
        return { activity: { ...activity, rideFulfillment }, member: existing, joined: false };
      }
      const effectiveActivity = normalizeRideCapacity({ ...activity, rideFulfillment });
      invariant(isRideJoinable(effectiveActivity, at), activity.memberCount >= rideCapacity(activity) ? 'CAPACITY_FULL' : 'CONFLICT', '该行程当前不可加入');
      const member = {
        ...(existing || { id: memberId, activityId, userId: actorId, role: 'MEMBER' }),
        status: MEMBER_STATUS.ACTIVE,
        joinedAt: at,
        luggageType
      };
      delete member.leftAt;
      delete member.leaveReason;
      const nextCount = Number(activity.memberCount || 0) + 1;
      const nextActivity = normalizeRideCapacity({ ...effectiveActivity, memberCount: nextCount });
      nextActivity.formedAt = nextActivity.status === ACTIVITY_STATUS.FORMED ? (activity.formedAt || at) : null;
      nextActivity.rideJoinable = isRideJoinable(nextActivity, at);
      nextActivity.updatedAt = at;
      nextActivity.version = Number(activity.version || 1) + 1;
      await memberRef.set({ data: document(member) });
      await activityRef.update({ data: {
        memberCount: nextCount,
        status: nextActivity.status,
        formedAt: nextActivity.formedAt || this.command.remove(),
        rideFulfillment,
        rideJoinable: nextActivity.rideJoinable,
        targetMembers: nextActivity.targetMembers,
        minPassengers: nextActivity.minPassengers,
        maxPassengers: nextActivity.maxPassengers,
        version: nextActivity.version,
        updatedAt: at
      } });
      if (application) await applicationRef.update({ data: { status: APPLICATION_STATUS.APPROVED, approvedAt: at, updatedAt: at } });
      return { activity: nextActivity, member, joined: true };
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
        rideJoinable: false,
        cancelReason: reason,
        cancelledAt: at,
        updatedAt: at,
        version: activity.version + 1
      };
      await transaction.collection('activities').doc(activityId).update({
        data: {
          status: nextActivity.status,
          ...(activity.type === 'ride' ? { rideJoinable: false } : {}),
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
        rideJoinable: false,
        completedAt: at,
        updatedAt: at,
        version: activity.version + 1
      };
      await transaction.collection('activities').doc(activityId).update({
        data: {
          status: nextActivity.status,
          ...(activity.type === 'ride' ? { rideJoinable: false } : {}),
          completedAt: at,
          updatedAt: at,
          version: nextActivity.version
        }
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
    const activeMemberResult = await this.db.collection('members').where({
      activityId,
      status: MEMBER_STATUS.ACTIVE
    }).count();
    invariant(
      isRideContactUnlocked(activity, Number(activeMemberResult.total || 0)),
      'CONFLICT',
      '拼车满7名有效乘客后才能查看联系信息'
    );
    return {
      activityId,
      contactInfo: activity.contactInfo,
      meeting: { city: activity.city, district: activity.district, placeLabel: activity.placeLabel, note: activity.rules || '' }
    };
  }

  async getDriver(userId) {
    return this.getDocument('drivers', userId);
  }

  async getVehicle(vehicleId) {
    return this.getDocument('vehicles', vehicleId);
  }

  async listVehiclesForDriver(driverId) {
    const result = await this.db.collection('vehicles').where({ driverId }).limit(20).get();
    return (result.data || []).map(entity);
  }

  async getRideFulfillment(activityId) {
    return this.getDocument('rideFulfillments', stableEntityId('rideFulfillment', activityId));
  }

  async acceptRideAtomic({ activityId, driverId, vehicleId, pickupAt, operationKeyHash, at }) {
    return this.db.runTransaction(async (transaction) => {
      const fulfillmentId = stableEntityId('rideFulfillment', activityId);
      const activity = first(await transaction.collection('activities').doc(activityId).get());
      const driver = first(await transaction.collection('drivers').doc(driverId).get());
      const vehicle = first(await transaction.collection('vehicles').doc(vehicleId).get());
      const fulfillment = first(await transaction.collection('rideFulfillments').doc(fulfillmentId).get());
      invariant(activity && activity.type === 'ride' && fulfillment, 'NOT_FOUND');
      invariant([ACTIVITY_STATUS.RECRUITING, ACTIVITY_STATUS.FORMED].includes(activity.status), 'CONFLICT', '当前行程暂不可承接');
      invariant(driver && driver.status === DRIVER_STATUS.ACTIVE && driver.reviewStatus === DRIVER_REVIEW_STATUS.APPROVED, 'DRIVER_NOT_APPROVED');
      invariant(vehicle && vehicle.driverId === driverId && vehicle.status === VEHICLE_STATUS.ACTIVE && vehicle.reviewStatus === VEHICLE_REVIEW_STATUS.APPROVED, 'VEHICLE_NOT_APPROVED');
      invariant(Number(vehicle.passengerCapacity) >= rideCapacity(activity), 'VEHICLE_NOT_APPROVED', '车辆核定乘客容量不足');
      const passengerMember = await getTransactionDocument(
        transaction.collection('members').doc(stableEntityId('member', activityId, driverId))
      );
      invariant(!passengerMember || passengerMember.status !== MEMBER_STATUS.ACTIVE, 'FORBIDDEN', '同一行程不能同时作为司机和乘客');
      if (fulfillment.status !== RIDE_FULFILLMENT_STATUS.UNASSIGNED) {
        if (fulfillment.operationKeyHash === operationKeyHash) return { activity, fulfillment };
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
      const user = first(await transaction.collection('users').doc(driverId).get());
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
      const rideFulfillment = {
        status: nextFulfillment.status,
        pickupAt,
        driver: nextFulfillment.driver,
        vehicle: nextFulfillment.vehicle
      };
      await transaction.collection('rideFulfillments').doc(fulfillmentId).update({
        data: document(nextFulfillment)
      });
      const normalizedActivity = normalizeRideCapacity({ ...activity, rideFulfillment });
      const rideJoinable = isRideJoinable(normalizedActivity, at);
      await transaction.collection('activities').doc(activityId).update({
        data: {
          rideFulfillment,
          rideJoinable,
          targetMembers: normalizedActivity.targetMembers,
          minPassengers: normalizedActivity.minPassengers,
          maxPassengers: normalizedActivity.maxPassengers,
          status: normalizedActivity.status,
          updatedAt: at,
          version: activity.version + 1
        }
      });
      return {
        activity: { ...normalizedActivity, rideFulfillment, rideJoinable, updatedAt: at, version: activity.version + 1 },
        fulfillment: nextFulfillment
      };
    });
  }

  async cancelRideAssignmentAtomic({ activityId, driverId, reason, at }) {
    return this.db.runTransaction(async (transaction) => {
      const fulfillmentId = stableEntityId('rideFulfillment', activityId);
      const activity = first(await transaction.collection('activities').doc(activityId).get());
      const fulfillment = first(await transaction.collection('rideFulfillments').doc(fulfillmentId).get());
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
      const rideFulfillment = { status: RIDE_FULFILLMENT_STATUS.UNASSIGNED };
      const rideJoinable = isRideJoinable({ ...activity, rideFulfillment }, at);
      await transaction.collection('rideFulfillments').doc(fulfillmentId).set({ data: document(nextFulfillment) });
      await transaction.collection('activities').doc(activityId).update({
        data: { rideFulfillment, rideJoinable, updatedAt: at, version: activity.version + 1 }
      });
      return {
        activity: { ...activity, rideFulfillment, rideJoinable, updatedAt: at, version: activity.version + 1 },
        fulfillment: nextFulfillment
      };
    });
  }

  async listDriverRides(driverId) {
    const result = await this.db.collection('rideFulfillments').where({ driverId }).orderBy('updatedAt', 'desc').limit(100).get();
    const fulfillments = (result.data || []).map(entity);
    const activityIds = fulfillments.map((item) => item.activityId);
    if (!activityIds.length) return [];
    const activityRows = await this.fetchActivitiesByIdsChunked(activityIds);
    const activities = new Map(activityRows.map((item) => [item.id, item]));
    return fulfillments.map((fulfillment) => {
      const activity = activities.get(fulfillment.activityId);
      return {
        activity: activity ? {
          ...activity,
          rideFulfillment: rideFulfillmentSummary(fulfillment),
          rideJoinable: false
        } : null,
        fulfillment
      };
    })
      .filter((item) => item.activity);
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
        ...(activity.type === 'ride' ? { rideJoinable: false } : {}),
        suspension: { adminId, reason, at },
        updatedAt: at,
        version: activity.version + 1
      }
    });
    return {
      ...activity,
      status: ACTIVITY_STATUS.SUSPENDED,
      ...(activity.type === 'ride' ? { rideJoinable: false } : {}),
      suspension: { adminId, reason, at },
      updatedAt: at
    };
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
