'use strict';

const crypto = require('crypto');
const { AppError, invariant, toPublicError } = require('./errors');
const { stableEntityId } = require('./ids');
const {
  ACTIVITY_STATUS,
  APPLICATION_STATUS,
  LEGACY_ACTIVITY_TYPE_MAP
} = require('./constants');
const {
  validateActivityInput,
  validateActivityListInput,
  validateApplicationInput,
  validateProfileInput,
  validateReportInput,
  validateActivityQuestionInput,
  validateActivityQuestionAnswerInput,
  validateCommunityListInput,
  validateCommunityPostCreateInput,
  validateCommunityReplyCreateInput,
  validateDirectMessageListInput,
  validateDirectConversationCreateInput,
  validateDirectMessageCreateInput,
  validateId,
  requireIdempotencyKey,
  stringValue
} = require('./validation');
const { createLocalModeration } = require('./moderation');
const { COMMUNITY_POST_STATUS, COMMUNITY_REPLY_STATUS } = require('./community');
const { resolveNotificationTarget } = require('./notification-target');
const { parsePublicCursor, normalizeActivityForRead } = require('./public-activity-page');
const {
  normalizeRideCapacity
} = require('./ride-policy');
const {
  avatarKindFromGender,
  isCompleteRideProfile
} = require('./passenger-avatar');

const MUTATING_ACTIONS = new Set([
  'profile.update',
  'activity.create',
  'activity.cancel',
  'activity.complete',
  'activity.question.ask',
  'activity.question.answer',
  'community.post.create',
  'community.reply.create',
  'community.post.delete',
  'community.reply.delete',
  'application.submit',
  'application.approve',
  'application.reject',
  'application.withdraw',
  'member.leave',
  'group.contact.share',
  'group.contact.revoke',
  'dm.conversation.create',
  'dm.message.send',
  'dm.conversation.read',
  'notification.read',
  'report.create',
  'admin.activity.suspend'
]);
const BUSINESS_IDEMPOTENT_ACTIONS = new Set();
const REMOVED_ACTIONS = new Set([
  'student.verification.get',
  'student.verification.submit',
  'student.document.prepare',
  'student.document.confirm',
  'admin.studentVerification.review',
  'onboarding.selectRole',
  'driver.application.get',
  'driver.application.submit',
  'driver.document.prepare',
  'driver.document.confirm',
  'driver.application.withdraw',
  'admin.driverApplication.review',
  'ride.join',
  'ride.driver.profile',
  'ride.driver.mine',
  'ride.driver.memberContacts',
  'ride.driver.accept',
  'ride.driver.cancel'
]);
const PAYLOAD_BOUND_IDEMPOTENT_ACTIONS = new Set([
  'community.post.create',
  'community.reply.create',
  'dm.message.send'
]);

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

function publicActivity(activity, viewer = {}, at) {
  const storedType = activity.type;
  activity = normalizeRideCapacity(activity);
  const maxPassengers = activity.maxMembers || activity.maxPassengers || activity.targetMembers;
  const minPassengers = activity.minMembers || activity.minPassengers || activity.targetMembers;
  const result = {
    id: activity.id,
    type: LEGACY_ACTIVITY_TYPE_MAP[storedType] || storedType,
    title: activity.title,
    description: activity.description,
    city: activity.city,
    district: activity.district,
    placeLabel: activity.placeLabel,
    startsAt: activity.startsAt,
    deadlineAt: activity.deadlineAt,
    targetMembers: activity.targetMembers,
    minMembers: activity.minMembers || minPassengers,
    maxMembers: activity.maxMembers || maxPassengers,
    minPassengers,
    maxPassengers,
    memberCount: activity.memberCount,
    remainingCapacity: Math.max(0, Number(maxPassengers) - Number(activity.memberCount || 0)),
    status: activity.status,
    rules: activity.rules,
    typeData: storedType === 'ride'
      ? {
          originLabel: activity.typeData && activity.typeData.origin && activity.typeData.origin.label || activity.placeLabel || '',
          destinationLabel: activity.typeData && activity.typeData.destination && activity.typeData.destination.label || '',
          timeFlexibility: 'WITHIN_60_MIN',
          transportPreference: 'DISCUSS_AFTER_FORMED',
          luggageType: 'NONE'
        }
      : storedType === 'buddy'
        ? {
            sportType: activity.typeData && (activity.typeData.sportType || activity.typeData.buddyType) || '运动活动',
            venue: activity.placeLabel || '',
            level: 'ANY',
            intensity: 'RELAXED',
            equipment: ''
          }
        : storedType === 'product'
          ? {
              venue: activity.placeLabel || '',
              cuisine: activity.typeData && activity.typeData.productName || '一起吃饭',
              budget: activity.typeData && activity.typeData.unitPriceRange || '',
              dietaryNotes: ''
            }
          : activity.typeData,
    owner: activity.owner && activity.owner.nickname
      ? { nickname: activity.owner.nickname }
      : null,
    createdAt: activity.createdAt,
    updatedAt: activity.updatedAt
  };
  if (LEGACY_ACTIVITY_TYPE_MAP[storedType]) {
    result.legacy = { sourceType: storedType, readOnly: true };
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
      ...(storedType === 'ride' ? { luggageType: viewer.member.luggageType || null } : {})
    };
  }
  result.viewerRole = viewer.role || 'guest';
  return result;
}

function publicCommunityPost(post, viewerId = '') {
  return {
    id: post.id,
    author: post.author ? { nickname: post.author.nickname, avatarKind: post.author.avatarKind } : null,
    content: post.content,
    replyCount: Number(post.replyCount || 0),
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    viewerIsAuthor: Boolean(viewerId && post.authorId === viewerId)
  };
}

function publicCommunityReply(reply, viewerId = '') {
  return {
    id: reply.id,
    postId: reply.postId,
    author: reply.author ? { nickname: reply.author.nickname, avatarKind: reply.author.avatarKind } : null,
    content: reply.content,
    createdAt: reply.createdAt,
    updatedAt: reply.updatedAt,
    viewerIsAuthor: Boolean(viewerId && reply.authorId === viewerId)
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

  function nowIso() {
    return clock().toISOString();
  }

  async function publicDirectConversation(conversation, actorId) {
    const peerId = conversation.participantAId === actorId
      ? conversation.participantBId
      : conversation.participantAId;
    const peer = await store.getUser(peerId);
    const sourceActivity = conversation.source && conversation.source.id
      ? await store.getActivity(conversation.source.id)
      : null;
    return {
      id: conversation.id,
      peer: {
        nickname: peer && peer.profile && peer.profile.nickname || '拼吧用户',
        avatarKind: avatarKindFromGender(peer && peer.profile && peer.profile.gender)
      },
      source: conversation.source
        ? { type: conversation.source.type, id: conversation.source.id, title: conversation.source.title || '' }
        : null,
      lastMessage: conversation.lastMessageId
        ? {
            id: conversation.lastMessageId,
            preview: conversation.lastMessagePreview || '',
            isMine: conversation.lastSenderId === actorId,
            createdAt: conversation.lastMessageAt
          }
        : null,
      unreadCount: Math.max(0, Number(conversation.unreadByUser && conversation.unreadByUser[actorId]) || 0),
      messagingAvailable: Boolean(sourceActivity && [ACTIVITY_STATUS.FORMED, ACTIVITY_STATUS.IN_PROGRESS].includes(sourceActivity.status)),
      updatedAt: conversation.updatedAt
    };
  }

  function publicDirectMessage(message, actorId) {
    return {
      id: message.id,
      conversationId: message.conversationId,
      text: message.text,
      isMine: message.senderId === actorId,
      status: message.status || 'SENT',
      createdAt: message.createdAt
    };
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
    if (REMOVED_ACTIONS.has(action)) throw new AppError('NOT_FOUND', '接口动作不存在');

    if (action === 'auth.login') {
      const actorId = requireActor(context);
      const user = assertActiveAccount(await store.ensureUser(actorId, at));
      return {
        user: selfUser(user),
        onboarding: {
          profileComplete: isCompleteRideProfile(user.profile)
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

    if (action === 'community.post.list') {
      const payload = validateCommunityListInput(input);
      const page = await store.listCommunityPosts(payload);
      return {
        items: page.items.map((item) => publicCommunityPost(item, context && context.actorId)),
        nextCursor: page.nextCursor || null
      };
    }

    if (action === 'community.post.detail') {
      const postId = validateId(input && input.postId, '帖子ID');
      const post = await store.getCommunityPost(postId);
      invariant(post && post.status === COMMUNITY_POST_STATUS.ACTIVE, post && post.status === COMMUNITY_POST_STATUS.SUSPENDED ? 'TAKEDOWN' : 'NOT_FOUND');
      const replyInput = validateCommunityListInput({ cursor: input && input.cursor, limit: input && input.limit || 30 });
      const page = await store.listCommunityReplies(postId, replyInput);
      return {
        post: publicCommunityPost(post, context && context.actorId),
        replies: page.items.map((item) => publicCommunityReply(item, context && context.actorId)),
        nextCursor: page.nextCursor || null
      };
    }

    if (action === 'community.post.create') {
      const user = await requireActiveUser(context);
      invariant(isCompleteRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先完善个人资料');
      const payload = validateCommunityPostCreateInput(input);
      await moderation.check([payload.content], { actorId: user.id, scene: 2 });
      await store.consumeCommunityRateLimit(user.id, 'post', at, 3, 10 * 60 * 1000);
      const post = {
        id: operationId(context, 'communityPost'),
        authorId: user.id,
        author: { nickname: user.profile.nickname, avatarKind: avatarKindFromGender(user.profile.gender) },
        content: payload.content,
        replyCount: 0,
        status: COMMUNITY_POST_STATUS.ACTIVE,
        submissionKeyHash: operationId(context, 'submission'),
        payloadHash: context.payloadHash,
        createdAt: at,
        updatedAt: at
      };
      const audit = { id: operationId(context, 'audit'), actorId: user.id, action, targetType: 'communityPost', targetId: post.id, at };
      return { post: publicCommunityPost(await store.createCommunityPost(post, audit), user.id) };
    }

    if (action === 'community.reply.create') {
      const user = await requireActiveUser(context);
      invariant(isCompleteRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先完善个人资料');
      const payload = validateCommunityReplyCreateInput(input);
      await moderation.check([payload.content], { actorId: user.id, scene: 2 });
      await store.consumeCommunityRateLimit(user.id, 'reply', at, 15, 10 * 60 * 1000);
      const reply = {
        id: operationId(context, `communityReply:${payload.postId}`),
        postId: payload.postId,
        authorId: user.id,
        author: { nickname: user.profile.nickname, avatarKind: avatarKindFromGender(user.profile.gender) },
        content: payload.content,
        status: COMMUNITY_REPLY_STATUS.ACTIVE,
        submissionKeyHash: operationId(context, 'submission'),
        payloadHash: context.payloadHash,
        createdAt: at,
        updatedAt: at
      };
      const audit = { id: operationId(context, 'audit'), actorId: user.id, action, targetType: 'communityReply', targetId: reply.id, at };
      return { reply: publicCommunityReply(await store.createCommunityReply(reply, audit), user.id) };
    }

    if (action === 'community.post.delete') {
      const user = await requireActiveUser(context, false);
      const postId = validateId(input && input.postId, '帖子ID');
      const audit = { id: operationId(context, 'audit'), actorId: user.id, action, targetType: 'communityPost', targetId: postId, at };
      await store.deleteCommunityPost(postId, user.id, at, audit);
      return { deleted: true, postId };
    }

    if (action === 'community.reply.delete') {
      const user = await requireActiveUser(context, false);
      const replyId = validateId(input && input.replyId, '回复ID');
      const audit = { id: operationId(context, 'audit'), actorId: user.id, action, targetType: 'communityReply', targetId: replyId, at };
      await store.deleteCommunityReply(replyId, user.id, at, audit);
      return { deleted: true, replyId };
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

    if (action === 'activity.create') {
      const user = await requireActiveUser(context, true);
      const payload = validateActivityInput(input, clock());
      const activityPayload = payload;
      await moderation.check([activityPayload.title, activityPayload.description, activityPayload.rules], { actorId: user.id, scene: 2 });
      const activityId = operationId(context, 'activity');
      const activity = {
        id: activityId,
        ownerId: user.id,
        owner: { nickname: user.profile.nickname },
        ...activityPayload,
        memberCount: 1,
        status: ACTIVITY_STATUS.RECRUITING,
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
        avatarKind: avatarKindFromGender(user.profile.gender)
      };
      const storedActivity = await store.createActivityWithOwner(activity, ownerMember, null, null);
      await store.addAudit({ id: operationId(context, 'audit'), actorId: user.id, action, targetType: 'activity', targetId: activityId, at });
      return { activity: publicActivity(storedActivity, { role: 'owner' }, at) };
    }

    if (action === 'application.submit') {
      const user = await requireActiveUser(context, true);
      const payload = validateApplicationInput(input);
      await moderation.check([payload.note], { actorId: user.id, scene: 2 });
      const activity = await store.getActivity(payload.activityId);
      invariant(activity, 'NOT_FOUND');
      invariant(!LEGACY_ACTIVITY_TYPE_MAP[activity.type], 'CONFLICT', '历史活动仅供查看');
      if (activity.memberCount >= (activity.maxMembers || activity.maxPassengers || activity.targetMembers)) throw new AppError('CAPACITY_FULL');
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
      const justFormed = result.activity.status === ACTIVITY_STATUS.FORMED;
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

    if (action === 'group.space') {
      const user = await requireActiveUser(context, false);
      const activityId = validateId(input && input.activityId, '活动ID');
      return store.getGroupSpace(activityId, user.id);
    }

    if (action === 'group.contact.share') {
      const user = await requireActiveUser(context, false);
      const activityId = validateId(input && input.activityId, '活动ID');
      const type = stringValue(input && input.type, '联系方式类型', { required: true, max: 20 });
      invariant(['WECHAT', 'MOBILE'].includes(type), 'VALIDATION_ERROR', '联系方式类型无效');
      const value = stringValue(input && input.value, '联系方式', { required: true, max: 40 });
      invariant(type === 'WECHAT' ? /^[A-Za-z][-_A-Za-z0-9]{5,19}$/.test(value) : /^\+?\d{8,15}$/.test(value), 'VALIDATION_ERROR', '联系方式格式无效');
      const space = await store.setGroupContact({ activityId, actorId: user.id, type, value, shared: true, at });
      await store.addAudit({ id: operationId(context, 'audit'), actorId: user.id, action, targetType: 'activity', targetId: activityId, at });
      return space;
    }

    if (action === 'group.contact.revoke') {
      const user = await requireActiveUser(context, false);
      const activityId = validateId(input && input.activityId, '活动ID');
      const space = await store.setGroupContact({ activityId, actorId: user.id, type: null, value: null, shared: false, at });
      await store.addAudit({ id: operationId(context, 'audit'), actorId: user.id, action, targetType: 'activity', targetId: activityId, at });
      return space;
    }

    if (action === 'dm.unread') {
      const user = await requireActiveUser(context);
      invariant(isCompleteRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先完善个人资料');
      return store.getDirectUnreadSummary(user.id);
    }

    if (action === 'dm.conversation.list') {
      const user = await requireActiveUser(context);
      invariant(isCompleteRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先完善个人资料');
      const payload = validateDirectMessageListInput(input);
      const page = await store.listDirectConversations(user.id, payload);
      return {
        items: await Promise.all(page.items.map((item) => publicDirectConversation(item, user.id))),
        nextCursor: page.nextCursor || null
      };
    }

    if (action === 'dm.conversation.create') {
      const user = await requireActiveUser(context);
      invariant(isCompleteRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先完善个人资料');
      const payload = validateDirectConversationCreateInput(input);
      const relationship = await store.resolveDirectMessagePeer(payload.activityId, user.id, payload.memberId);
      const participantIds = [user.id, relationship.peerUserId].sort();
      const conversation = await store.upsertDirectConversation({
        id: stableEntityId('conversation', relationship.activity.id, ...participantIds),
        participantAId: participantIds[0],
        participantBId: participantIds[1],
        source: { type: 'activity', id: relationship.activity.id, title: relationship.activity.title || '' },
        lastMessageId: null,
        lastMessagePreview: '',
        lastMessageAt: null,
        lastSenderId: null,
        unreadByUser: { [participantIds[0]]: 0, [participantIds[1]]: 0 },
        createdAt: at,
        updatedAt: at
      });
      return { conversation: await publicDirectConversation(conversation, user.id) };
    }

    if (action === 'dm.message.list') {
      const user = await requireActiveUser(context);
      invariant(isCompleteRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先完善个人资料');
      const conversationId = validateId(input && input.conversationId, '会话ID');
      const payload = validateDirectMessageListInput(input);
      const conversation = await store.getDirectConversation(conversationId);
      invariant(conversation && [conversation.participantAId, conversation.participantBId].includes(user.id), 'NOT_FOUND_OR_NOT_ALLOWED');
      const page = await store.listDirectMessages(conversationId, user.id, payload);
      return {
        conversation: await publicDirectConversation(conversation, user.id),
        items: page.items.map((item) => publicDirectMessage(item, user.id)),
        nextCursor: page.nextCursor || null
      };
    }

    if (action === 'dm.message.send') {
      const user = await requireActiveUser(context);
      invariant(isCompleteRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先完善个人资料');
      const payload = validateDirectMessageCreateInput(input);
      const conversation = await store.getDirectConversation(payload.conversationId);
      invariant(conversation && [conversation.participantAId, conversation.participantBId].includes(user.id), 'NOT_FOUND_OR_NOT_ALLOWED');
      const sourceActivity = conversation.source && conversation.source.id
        ? await store.getActivity(conversation.source.id)
        : null;
      invariant(sourceActivity && [ACTIVITY_STATUS.FORMED, ACTIVITY_STATUS.IN_PROGRESS].includes(sourceActivity.status), 'CONFLICT', '共同活动已结束，这段私信现为只读');
      await moderation.check([payload.text], { actorId: user.id, scene: 2 });
      await store.consumeCommunityRateLimit(user.id, 'directMessage', at, 30, 10 * 60 * 1000);
      const message = await store.addDirectMessage({
        id: stableEntityId('directMessage', conversation.id, user.id, payload.clientMessageId),
        conversationId: conversation.id,
        senderId: user.id,
        text: payload.text,
        clientMessageId: payload.clientMessageId,
        payloadHash: context.payloadHash,
        status: 'SENT',
        createdAt: at,
        updatedAt: at
      });
      return { message: publicDirectMessage(message, user.id) };
    }

    if (action === 'dm.conversation.read') {
      const user = await requireActiveUser(context);
      invariant(isCompleteRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先完善个人资料');
      const conversationId = validateId(input && input.conversationId, '会话ID');
      const lastMessageId = validateId(input && input.lastMessageId, '已读消息ID');
      const existing = await store.getDirectConversation(conversationId);
      invariant(existing && [existing.participantAId, existing.participantBId].includes(user.id), 'NOT_FOUND_OR_NOT_ALLOWED');
      const conversation = await store.markDirectConversationRead(conversationId, user.id, lastMessageId, at);
      return {
        conversation: await publicDirectConversation(conversation, user.id),
        unread: Math.max(0, Number(conversation.unreadByUser && conversation.unreadByUser[user.id]) || 0),
        readAt: at
      };
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
      if (payload.targetType === 'directConversation') {
        const conversation = await store.getDirectConversation(payload.targetId);
        invariant(conversation && [conversation.participantAId, conversation.participantBId].includes(user.id), 'NOT_FOUND_OR_NOT_ALLOWED');
      }
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
        const payloadHash = crypto.createHash('sha256').update(stableSerialize(input)).digest('hex');
        const cacheAction = PAYLOAD_BOUND_IDEMPOTENT_ACTIONS.has(action) ? `${action}:${payloadHash}` : action;
        const cached = BUSINESS_IDEMPOTENT_ACTIONS.has(action) ? null : await store.getIdempotency(actorId, cacheAction, key);
        if (cached) return { ok: true, data: cached, requestId, idempotentReplay: true };
        data = await runAction(action, input, { ...context, idempotencyKey: key, payloadHash });
        if (!BUSINESS_IDEMPOTENT_ACTIONS.has(action)) await store.saveIdempotency(actorId, cacheAction, key, data, nowIso());
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
  publicCommunityPost,
  publicCommunityReply,
  publicNotification,
  selfUser
};
