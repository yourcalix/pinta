'use strict';

const crypto = require('crypto');
const { AppError, invariant, toPublicError } = require('./errors');
const { stableEntityId } = require('./ids');
const {
  ACTIVITY_TYPES,
  ACTIVITY_STATUS,
  APPLICATION_STATUS,
  USER_GENDERS,
  USER_MBTI_TYPES,
  MEMBER_LUGGAGE_TYPES,
  COMPANION_TIME_FLEXIBILITY,
  COMPANION_TRANSPORT_PREFERENCES,
  FOOD_PAYMENT_METHODS,
  FOOD_GENDER_PREFERENCES,
  COMPANION_PREFERENCE_VALUES,
  LEGACY_ACTIVITY_TYPE_MAP
} = require('./constants');
const {
  validateActivityInput,
  validateActivityListInput,
  validateActivityNearbyInput,
  validateActivityMemoriesInput,
  validateApplicationInput,
  validateProfileInput,
  validateProfileAvatarConfirmInput,
  validateReportInput,
  validateActivityQuestionInput,
  validateActivityQuestionAnswerInput,
  validateCommunityListInput,
  validateCompanionPresenceInput,
  validateCompanionDirectorySnapshotInput,
  validateCompanionDirectoryNavInput,
  validatePublicProfileGetInput,
  validateCommunityProfileNavCreateInput,
  validateCommunityPostCreateInput,
  validateCommunityReplyCreateInput,
  validateCommunityLikeInput,
  validateCommunityActivityListInput,
  validateCommunityActivityUnreadInput,
  validateCommunityActivityReadInput,
  validateDirectMessageListInput,
  validateDirectConversationCreateInput,
  validateDirectMessageCreateInput,
  validateGroupMessageListInput,
  validateGroupMessageCreateInput,
  validateGroupReadInput,
  validateId,
  requireIdempotencyKey,
  stringValue
} = require('./validation');
const { encodeNearbyCursor } = require('./activity-location');
const { createLocalModeration } = require('./moderation');
const { COMMUNITY_POST_STATUS, COMMUNITY_REPLY_STATUS } = require('./community');
const {
  COMMUNITY_ACTIVITY_TYPES,
  COMMUNITY_ACTIVITY_STATUS,
  communityReplyActivityId,
  communityLikeActivityId,
  communityReplyLikeActivityId
} = require('./community-activity');
const { resolveNotificationTarget } = require('./notification-target');
const { parsePublicCursor, normalizeActivityForRead } = require('./public-activity-page');
const {
  normalizeRideCapacity
} = require('./ride-policy');
const {
  avatarKindFromGender,
  publicAvatarSlot,
  publicAvatarSlots,
  isCompleteRideProfile
} = require('./passenger-avatar');
const { safeSelfAvatar } = require('./profile-avatar');
const { calculateAgeOnMacauDate } = require('./profile-birth-date');
const {
  COMPANION_PRESENCE_TTL_MS,
  COMPANION_HEARTBEAT_INTERVAL_MS,
  COMPANION_MIN_WRITE_INTERVAL_MS,
  COMPANION_SAMPLE_LIMIT,
  companionPresenceId,
  layoutSeedForPresence,
  safePresenceNickname,
  createProfileNavNonce,
  profileNavNonceFromToken,
  profileNavExpiresAt,
  resolveProfileNavPresence,
  publicCompanionSnapshot
} = require('./companion-presence');
const {
  COMPANION_DIRECTORY_SAMPLE_LIMIT,
  publicCompanionDirectorySnapshot,
  resolveCompanionDirectoryUser
} = require('./companion-directory');
const {
  createCommunityProfileNavTicket,
  communityProfileNavTicketId,
  resolveCommunityProfileNavTicket,
  createDirectoryProfileNavTicket,
  directoryProfileNavTicketId,
  resolveDirectoryProfileNavTicket
} = require('./community-profile-navigation');

const MUTATING_ACTIONS = new Set([
  'profile.update',
  'profile.avatar.prepare',
  'profile.avatar.confirm',
  'profile.avatar.clear',
  'activity.create',
  'activity.cancel',
  'activity.complete',
  'activity.question.ask',
  'activity.question.answer',
  'community.post.create',
  'community.reply.create',
  'community.post.delete',
  'community.reply.delete',
  'community.like.set',
  'community.activity.read',
  'community.profile.nav.create',
  'companion.directory.profile.nav.create',
  'companion.presence.enter',
  'companion.presence.heartbeat',
  'companion.presence.leave',
  'application.submit',
  'application.approve',
  'application.reject',
  'application.withdraw',
  'member.leave',
  'group.contact.share',
  'group.contact.revoke',
  'group.message.send',
  'group.message.read',
  'dm.conversation.create',
  'dm.consult.create',
  'dm.message.send',
  'dm.conversation.read',
  'notification.read',
  'report.create',
  'admin.activity.suspend'
]);
const BUSINESS_IDEMPOTENT_ACTIONS = new Set([
  'community.like.set',
  'community.activity.read',
  'companion.presence.heartbeat',
  'companion.presence.leave',
  // Membership generation and current activity state must be checked on every
  // replay; the store owns idempotency for group messages.
  'group.message.send',
  'group.message.read',
  'dm.consult.create',
  'dm.message.send'
]);
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
  'community.profile.nav.create',
  'companion.directory.profile.nav.create',
  'dm.message.send',
  'group.message.send'
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
          birthDate: user.profile.birthDate || null,
          mbti: user.profile.mbti || null,
          adultConfirmed: user.profile.adultConfirmed === true,
          avatar: safeSelfAvatar(user.profile.avatar)
        }
      : null,
    profileComplete: isCompleteRideProfile(user.profile)
  };
}

function publicCompanionProfile(user, viewerId, at, online = true, avatarFacts = null) {
  const profile = user && user.profile || {};
  const interests = Array.isArray(profile.interests)
    ? profile.interests.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
    : [];
  return {
    nickname: safePresenceNickname(profile.nickname),
    avatarKind: avatarKindFromGender(profile.gender),
    avatar: publicAvatarSlot(avatarFacts || { gender: profile.gender }),
    gender: USER_GENDERS.includes(profile.gender) ? profile.gender : null,
    age: calculateAgeOnMacauDate(profile.birthDate, at),
    mbti: USER_MBTI_TYPES.includes(profile.mbti) ? profile.mbti : null,
    city: typeof profile.city === 'string' ? profile.city.trim().slice(0, 20) : '',
    interests,
    online,
    viewerIsSelf: Boolean(viewerId && user && user.id === viewerId)
  };
}

function publicFoodTypeData(source) {
  const typeData = source && typeof source === 'object' ? source : {};
  return {
    venue: typeof typeData.venue === 'string' ? typeData.venue : '',
    cuisine: typeof typeData.cuisine === 'string' ? typeData.cuisine : '',
    budgetRange: typeof typeData.budgetRange === 'string' ? typeData.budgetRange : typeof typeData.budget === 'string' ? typeData.budget : '',
    dietaryNotes: typeof typeData.dietaryNotes === 'string' ? typeData.dietaryNotes : '',
    paymentMethod: FOOD_PAYMENT_METHODS.includes(typeData.paymentMethod) ? typeData.paymentMethod : 'FIFTY_FIFTY',
    genderPreference: FOOD_GENDER_PREFERENCES.includes(typeData.genderPreference) ? typeData.genderPreference : '',
    mbtiPreference: USER_MBTI_TYPES.includes(typeData.mbtiPreference) ? typeData.mbtiPreference : ''
  };
}

function publicCompanionTypeData(source) {
  const typeData = source && typeof source === 'object' ? source : {};
  const preferences = typeData.preferences && typeof typeData.preferences === 'object' && !Array.isArray(typeData.preferences)
    ? typeData.preferences
    : {};
  const safePreference = (key) => COMPANION_PREFERENCE_VALUES[key].includes(preferences[key]) ? preferences[key] : '';
  return {
    originLabel: typeof typeData.originLabel === 'string' ? typeData.originLabel : '',
    destinationLabel: typeof typeData.destinationLabel === 'string' ? typeData.destinationLabel : '',
    timeFlexibility: COMPANION_TIME_FLEXIBILITY.includes(typeData.timeFlexibility) ? typeData.timeFlexibility : 'ON_TIME',
    transportPreference: COMPANION_TRANSPORT_PREFERENCES.includes(typeData.transportPreference) ? typeData.transportPreference : 'DISCUSS_AFTER_FORMED',
    luggageType: MEMBER_LUGGAGE_TYPES.includes(typeData.luggageType) ? typeData.luggageType : 'NONE',
    preferences: {
      friendGender: safePreference('friendGender'),
      mbti: safePreference('mbti'),
      navigationStyle: safePreference('navigationStyle'),
      travelPace: safePreference('travelPace'),
      photoHabit: safePreference('photoHabit'),
      silenceComfort: safePreference('silenceComfort'),
      garlic: safePreference('garlic'),
      fragrance: safePreference('fragrance'),
      slippers: safePreference('slippers')
    }
  };
}

function publicActivity(activity, viewer = {}, at, avatarHydration = {}) {
  const storedType = activity.type;
  activity = normalizeRideCapacity(activity);
  const maxPassengers = activity.maxMembers || activity.maxPassengers || activity.targetMembers;
  const minPassengers = activity.minMembers || activity.minPassengers || activity.targetMembers;
  const ownerFacts = avatarHydration.ownerProfile || {};
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
    avatarSlots: publicAvatarSlots(
      avatarHydration.roster || activity.avatarRoster,
      maxPassengers,
      avatarHydration.profilesByMemberId || {}
    ),
    remainingCapacity: Math.max(0, Number(maxPassengers) - Number(activity.memberCount || 0)),
    status: activity.status,
    formedAt: activity.status === ACTIVITY_STATUS.FORMED && Number.isFinite(Date.parse(activity.formedAt))
      ? activity.formedAt
      : null,
    rules: activity.rules,
    typeData: storedType === 'companion'
      ? publicCompanionTypeData(activity.typeData)
      : storedType === 'ride'
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
        : storedType === 'food'
          ? publicFoodTypeData(activity.typeData)
          : storedType === 'product'
          ? {
              venue: activity.placeLabel || '',
              cuisine: activity.typeData && activity.typeData.productName || '一起吃饭',
              budgetRange: activity.typeData && activity.typeData.unitPriceRange || '',
              dietaryNotes: '',
              paymentMethod: 'FIFTY_FIFTY',
              genderPreference: '',
              mbtiPreference: ''
            }
          : activity.typeData,
    owner: activity.owner && activity.owner.nickname
      ? { nickname: activity.owner.nickname }
      : null,
    ownerProfile: {
      nickname: activity.owner && activity.owner.nickname
        ? String(activity.owner.nickname)
        : '拼吧用户',
      avatar: publicAvatarSlot(ownerFacts),
      gender: USER_GENDERS.includes(ownerFacts.gender) ? ownerFacts.gender : null,
      age: Number.isInteger(ownerFacts.age) && ownerFacts.age >= 18 && ownerFacts.age <= 150 ? ownerFacts.age : null,
      mbti: USER_MBTI_TYPES.includes(ownerFacts.mbti) ? ownerFacts.mbti : null
    },
    createdAt: activity.createdAt,
    updatedAt: activity.updatedAt
  };
  if (LEGACY_ACTIVITY_TYPE_MAP[storedType]) {
    result.legacy = { sourceType: storedType, readOnly: true };
  }
  if (activity.meetingPoint && typeof activity.meetingPoint.label === 'string') {
    result.meetingPoint = {
      label: activity.meetingPoint.label,
      address: typeof activity.meetingPoint.address === 'string' ? activity.meetingPoint.address : ''
    };
  }
  if (Number.isFinite(activity._distanceMeters)) {
    result.nearby = { distanceMeters: Math.max(0, Math.round(activity._distanceMeters)) };
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

function legacyCommunityAuthorProfile(item) {
  const avatarKind = item && item.author && item.author.avatarKind;
  return { gender: avatarKind === 'PASSENGER_A' ? 'MALE' : avatarKind === 'PASSENGER_B' ? 'FEMALE' : null };
}

function publicCommunityAuthor(item, profilesByUserId = {}) {
  if (!item || !item.author) return null;
  const hasHydratedProfile = item.authorId && Object.prototype.hasOwnProperty.call(profilesByUserId, item.authorId);
  const profile = hasHydratedProfile ? profilesByUserId[item.authorId] : legacyCommunityAuthorProfile(item);
  return {
    nickname: item.author.nickname,
    avatarKind: item.author.avatarKind,
    avatar: publicAvatarSlot(profile)
  };
}

function publicCommunityPost(post, viewerId = '', viewerHasLiked = false, profilesByUserId = {}) {
  return {
    id: post.id,
    author: publicCommunityAuthor(post, profilesByUserId),
    content: post.content,
    replyCount: Number(post.replyCount || 0),
    likeCount: Number(post.likeCount || 0),
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    viewerIsAuthor: Boolean(viewerId && post.authorId === viewerId),
    viewerHasLiked: Boolean(viewerHasLiked)
  };
}

function publicCommunityReply(reply, viewerId = '', viewerHasLiked = false, profilesByUserId = {}, replyTargetsById = new Map()) {
  const target = reply.replyToId ? replyTargetsById.get(reply.replyToId) : null;
  const targetActive = Boolean(target && target.status === COMMUNITY_REPLY_STATUS.ACTIVE && target.postId === reply.postId);
  const targetAuthor = targetActive ? publicCommunityAuthor(target, profilesByUserId) : null;
  return {
    id: reply.id,
    postId: reply.postId,
    author: publicCommunityAuthor(reply, profilesByUserId),
    content: reply.content,
    likeCount: Number(reply.likeCount || 0),
    createdAt: reply.createdAt,
    updatedAt: reply.updatedAt,
    viewerIsAuthor: Boolean(viewerId && reply.authorId === viewerId),
    viewerHasLiked: Boolean(viewerHasLiked),
    ...(reply.replyToId ? { replyTo: targetAuthor ? { status: 'ACTIVE', nickname: targetAuthor.nickname } : { status: 'UNAVAILABLE', nickname: '' } } : {})
  };
}

function publicCommunityActivity(activity, post, reply, profilesByUserId = {}) {
  const postActive = Boolean(post && post.status === COMMUNITY_POST_STATUS.ACTIVE);
  const replyActive = Boolean(reply && reply.status === COMMUNITY_REPLY_STATUS.ACTIVE);
  const isPostLike = activity.type === COMMUNITY_ACTIVITY_TYPES.POST_LIKED;
  const isReplyLike = activity.type === COMMUNITY_ACTIVITY_TYPES.REPLY_LIKED;
  const isLike = isPostLike || isReplyLike;
  const removed = !postActive || (isReplyLike && !replyActive);
  const actorItems = isLike
    ? (activity.recentActors || [])
    : activity.actorId ? [{ actorId: activity.actorId, author: activity.actor }] : [];
  const actors = actorItems.map((item) => publicCommunityAuthor({ authorId: item.actorId, author: item.author }, profilesByUserId)).filter(Boolean);
  return {
    id: activity.id,
    type: activity.type,
    postId: activity.postId,
    ...(activity.replyId ? { replyId: activity.replyId } : {}),
    ...(isLike ? { likeTargetType: isReplyLike ? 'reply' : 'post' } : {}),
    actors,
    actorCount: isLike ? Math.max(0, Number(activity.actorCount) || 0) : actors.length,
    postPreview: removed ? '' : String(post.content || '').slice(0, 100),
    contentPreview: !removed && (activity.type === COMMUNITY_ACTIVITY_TYPES.POST_REPLIED || isReplyLike) && replyActive ? String(reply.content || '').slice(0, 100) : '',
    message: activity.type === COMMUNITY_ACTIVITY_TYPES.POST_STATUS ? String(activity.message || '').slice(0, 120) : '',
    removed,
    read: activity.read === true,
    createdAt: activity.createdAt,
    updatedAt: activity.updatedAt
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

  async function publicActivities(activities, viewers, at) {
    const items = (activities || []).filter(Boolean);
    let hydration = { rostersByActivity: {}, profilesByMemberId: {}, ownerProfilesByActivity: {} };
    if (typeof store.hydratePublicActivityAvatars === 'function') {
      try {
        hydration = await store.hydratePublicActivityAvatars(items, at);
      } catch (error) {
        console.error('[pinba-public-avatar-hydration]', {
          activityCount: items.length,
          code: error && (error.errCode || error.code) || 'UNKNOWN'
        });
      }
    }
    return items.map((activity, index) => publicActivity(activity, Array.isArray(viewers) ? viewers[index] || {} : viewers || {}, at, {
      roster: hydration.rostersByActivity && hydration.rostersByActivity[activity.id],
      profilesByMemberId: hydration.profilesByMemberId || {},
      ownerProfile: hydration.ownerProfilesByActivity && hydration.ownerProfilesByActivity[activity.id]
    }));
  }

  async function onePublicActivity(activity, viewer, at) {
    const items = await publicActivities(activity ? [activity] : [], [viewer || {}], at);
    return items[0] || null;
  }

  async function companionSnapshot(actorId, at) {
    const page = await store.snapshotCompanionPresence('companion_globe', at, COMPANION_SAMPLE_LIMIT);
    return publicCompanionSnapshot(page, actorId, at);
  }

  async function companionDirectorySnapshot(actorId, at, knownEtag = '') {
    const [page, presence] = await Promise.all([
      store.snapshotCompanionDirectory(COMPANION_DIRECTORY_SAMPLE_LIMIT),
      store.snapshotCompanionPresence('companion_globe', at, 1)
    ]);
    return publicCompanionDirectorySnapshot(page, presence.total, actorId, at, knownEtag);
  }

  async function communityAuthorProfiles(items) {
    if (typeof store.hydratePublicCommunityAuthors !== 'function') return {};
    try {
      const hydration = await store.hydratePublicCommunityAuthors(items);
      return hydration && hydration.profilesByUserId || {};
    } catch (error) {
      console.error('[pinba-community-avatar-hydration]', {
        itemCount: (items || []).length,
        code: error && (error.errCode || error.code) || 'UNKNOWN'
      });
      return {};
    }
  }

  async function communityReplyTargets(items = []) {
    const ids = [...new Set(items.map((item) => item && item.replyToId).filter(Boolean))];
    if (!ids.length) return new Map();
    const targets = typeof store.getCommunityRepliesByIds === 'function'
      ? await store.getCommunityRepliesByIds(ids)
      : await Promise.all(ids.map((id) => store.getCommunityReply(id)));
    return new Map((targets || []).filter(Boolean).map((item) => [item.id, item]));
  }

  async function refreshCachedActivity(data, context, at) {
    const communityKey = data && data.post && data.post.author ? 'post' : data && data.reply && data.reply.author ? 'reply' : '';
    if (communityKey) {
      const cachedItem = data[communityKey];
      if (communityKey === 'reply' && cachedItem.id) {
        const storedReply = await store.getCommunityReply(cachedItem.id);
        if (storedReply && storedReply.replyToId) {
          const replyTargetsById = await communityReplyTargets([storedReply]);
          const profilesByUserId = await communityAuthorProfiles([storedReply, ...replyTargetsById.values()]);
          const refreshed = publicCommunityReply(storedReply, context && context.actorId, cachedItem.viewerHasLiked, profilesByUserId, replyTargetsById);
          return { ...data, reply: { ...cachedItem, author: refreshed.author, replyTo: refreshed.replyTo } };
        }
      }
      const authorItem = { authorId: context && context.actorId, author: cachedItem.author };
      const profilesByUserId = await communityAuthorProfiles([authorItem]);
      return { ...data, [communityKey]: { ...cachedItem, author: publicCommunityAuthor(authorItem, profilesByUserId) } };
    }
    if (!data || !data.activity || !data.activity.id) return data;
    const emptyCachedAvatarSlots = () => {
      const capacity = data.activity.maxMembers || data.activity.maxPassengers || data.activity.targetMembers;
      const ownerProfile = {
        nickname: data.activity.ownerProfile && data.activity.ownerProfile.nickname
          || data.activity.owner && data.activity.owner.nickname
          || '拼吧用户',
        avatar: publicAvatarSlot(null),
        gender: null,
        age: null,
        mbti: null
      };
      return { ...data, activity: { ...data.activity, avatarSlots: publicAvatarSlots([], capacity), ownerProfile } };
    };
    try {
      const stored = normalizeActivityForRead(await store.getActivity(data.activity.id), at);
      if (!stored) return emptyCachedAvatarSlots();
      const actorId = context && context.actorId;
      const viewer = actorId ? await store.getViewerContext(stored.id, actorId) : {};
      if (data.activity.viewerRole === 'admin') viewer.role = 'admin';
      return { ...data, activity: await onePublicActivity(stored, viewer, at) };
    } catch (error) {
      console.error('[pinba-idempotent-avatar-refresh]', {
        code: error && (error.errCode || error.code) || 'UNKNOWN'
      });
      return emptyCachedAvatarSlots();
    }
  }

  async function publicDirectConversation(conversation, actorId) {
    const peerId = conversation.participantAId === actorId
      ? conversation.participantBId
      : conversation.participantAId;
    const peer = await store.getUser(peerId);
    const sourceActivity = conversation.source && conversation.source.id
      ? await store.getActivity(conversation.source.id)
      : null;
    const sourceActivityType = sourceActivity
      ? LEGACY_ACTIVITY_TYPE_MAP[sourceActivity.type] || sourceActivity.type
      : null;
    return {
      id: conversation.id,
      kind: conversation.kind === 'OWNER_CONSULT' ? 'OWNER_CONSULT' : 'MEMBER_DM',
      peer: {
        nickname: peer && peer.profile && peer.profile.nickname || '拼吧用户',
        avatarKind: avatarKindFromGender(peer && peer.profile && peer.profile.gender)
      },
      source: conversation.source
        ? {
            type: conversation.source.type,
            activityType: ACTIVITY_TYPES.includes(sourceActivityType) ? sourceActivityType : null,
            id: conversation.source.id,
            title: conversation.source.title || ''
          }
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
      messagingAvailable: await store.isDirectMessagingAvailable(conversation),
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

  function publicGroupMessage(message, actorId) {
    return {
      id: message.id,
      sequence: message.sequence,
      text: message.text,
      isMine: message.senderId === actorId,
      sender: message.sender ? {
        nickname: message.sender.nickname || '拼吧成员',
        avatarKind: message.sender.avatarKind || null,
        role: message.sender.role === 'OWNER' ? 'OWNER' : 'MEMBER'
      } : { nickname: '拼吧成员', avatarKind: null, role: 'MEMBER' },
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

  async function requireKnownUser(context) {
    const actorId = requireActor(context);
    const user = await store.getUser(actorId);
    invariant(user, 'UNAUTHENTICATED');
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

    if (action === 'profile.public.get') {
      const { profileNavToken } = validatePublicProfileGetInput(input);
      if (profileNavToken.startsWith('directoryProfileNa_')) {
        const viewer = await requireActiveUser(context, false);
        const ticketId = directoryProfileNavTicketId(profileNavToken);
        const candidate = ticketId && typeof store.getPublicProfileNavTicket === 'function'
          ? await store.getPublicProfileNavTicket(ticketId)
          : null;
        const ticket = resolveDirectoryProfileNavTicket(candidate, profileNavToken, viewer.id, at);
        invariant(ticket, 'NOT_FOUND');
        const target = await store.getUser(ticket.targetUserId);
        invariant(target && target.status === 'ACTIVE', 'NOT_FOUND');
        const avatarFacts = typeof store.hydratePublicProfileAvatar === 'function'
          ? await store.hydratePublicProfileAvatar(target)
          : null;
        return {
          profile: publicCompanionProfile(target, viewer.id, at, false, avatarFacts),
          serverNow: at,
          expiresAt: ticket.expiresAt
        };
      }
      if (profileNavToken.startsWith('communityProfileNa_')) {
        const viewer = await requireActiveUser(context, false);
        const ticketId = communityProfileNavTicketId(profileNavToken);
        const candidate = ticketId && typeof store.getPublicProfileNavTicket === 'function'
          ? await store.getPublicProfileNavTicket(ticketId)
          : null;
        const ticket = resolveCommunityProfileNavTicket(candidate, profileNavToken, viewer.id, at);
        invariant(ticket, 'NOT_FOUND');
        const source = ticket.sourceType === 'post'
          ? await store.getCommunityPost(ticket.sourceId)
          : await store.getCommunityReply(ticket.sourceId);
        invariant(source && source.authorId === ticket.targetUserId && source.status === (ticket.sourceType === 'post' ? COMMUNITY_POST_STATUS.ACTIVE : COMMUNITY_REPLY_STATUS.ACTIVE), 'NOT_FOUND');
        if (ticket.sourceType === 'reply') {
          const parent = await store.getCommunityPost(source.postId);
          invariant(parent && parent.status === COMMUNITY_POST_STATUS.ACTIVE, 'NOT_FOUND');
        }
        const target = await store.getUser(ticket.targetUserId);
        invariant(target && target.status === 'ACTIVE' && target.profile, 'NOT_FOUND');
        const avatarFacts = typeof store.hydratePublicProfileAvatar === 'function'
          ? await store.hydratePublicProfileAvatar(target)
          : null;
        return {
          profile: publicCompanionProfile(target, viewer.id, at, false, avatarFacts),
          serverNow: at,
          expiresAt: ticket.expiresAt
        };
      }
      const profileNavNonce = profileNavNonceFromToken(profileNavToken);
      const candidate = profileNavNonce && typeof store.findCompanionPresenceByProfileNavNonce === 'function'
        ? await store.findCompanionPresenceByProfileNavNonce(profileNavNonce)
        : null;
      const presence = resolveProfileNavPresence(candidate, profileNavToken, at);
      invariant(presence, 'NOT_FOUND');
      const target = await store.getUser(presence.userId);
      invariant(target && target.status === 'ACTIVE' && target.profile, 'NOT_FOUND');
      const avatarFacts = typeof store.hydratePublicProfileAvatar === 'function'
        ? await store.hydratePublicProfileAvatar(target)
        : null;
      return {
        profile: publicCompanionProfile(target, context && context.actorId, at, true, avatarFacts),
        serverNow: at,
        expiresAt: profileNavExpiresAt(presence, at)
      };
    }

    if (action === 'profile.update') {
      const actorId = requireActor(context);
      const currentUser = assertActiveAccount(await store.ensureUser(actorId, at));
      const profile = validateProfileInput(input, at);
      if (!Object.prototype.hasOwnProperty.call(input, 'birthDate') && currentUser.profile && currentUser.profile.birthDate) {
        profile.birthDate = currentUser.profile.birthDate;
      }
      if ((!Object.prototype.hasOwnProperty.call(input, 'mbti') || input.mbti === undefined) && currentUser.profile && Object.prototype.hasOwnProperty.call(currentUser.profile, 'mbti')) {
        profile.mbti = currentUser.profile.mbti;
      }
      if (currentUser.profile && currentUser.profile.avatar) profile.avatar = currentUser.profile.avatar;
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

    if (action === 'profile.avatar.prepare') {
      const user = await requireActiveUser(context, false);
      const uploadId = idGenerator();
      const actorScope = crypto.createHash('sha256').update(user.id).digest('hex').slice(0, 24);
      const upload = {
        id: uploadId,
        userId: user.id,
        cloudPath: `private-profile-avatar-temp/${actorScope}/${uploadId}.jpg`,
        status: 'PREPARED',
        expiresAt: new Date(Date.parse(at) + 15 * 60 * 1000).toISOString(),
        createdAt: at,
        updatedAt: at
      };
      await store.registerProfileAvatarUpload(upload);
      return { upload: { id: upload.id, cloudPath: upload.cloudPath, expiresAt: upload.expiresAt, maxBytes: 1024 * 1024 } };
    }

    if (action === 'profile.avatar.confirm') {
      const user = await requireActiveUser(context, false);
      const inputData = validateProfileAvatarConfirmInput(input);
      let candidate;
      try {
        candidate = await store.inspectProfileAvatarUpload({ userId: user.id, ...inputData, at });
      } catch (error) {
        if (typeof store.discardProfileAvatarUpload === 'function') {
          try { await store.discardProfileAvatarUpload({ userId: user.id, ...inputData, at }); } catch (cleanupError) { /* preserve the inspection failure */ }
        }
        throw error;
      }
      if (candidate.bound) return { user: selfUser(await store.getUser(user.id)) };
      let moderationResult;
      try {
        moderationResult = await moderation.checkImage(candidate.fileContent, { contentType: candidate.metadata.contentType, actorId: user.id });
      } catch (error) {
        if (typeof store.discardProfileAvatarUpload === 'function') {
          try { await store.discardProfileAvatarUpload({ userId: user.id, ...inputData, at }); } catch (cleanupError) { /* preserve the moderation failure */ }
        }
        throw error;
      }
      const updated = await store.bindProfileAvatar({ userId: user.id, ...inputData, ...candidate, moderationProvider: moderationResult.provider, at });
      await store.addAudit({ id: operationId(context, 'audit'), actorId: user.id, action, targetType: 'user', targetId: user.id, at });
      return { user: selfUser(updated) };
    }

    if (action === 'profile.avatar.clear') {
      const user = await requireActiveUser(context, false);
      const updated = await store.clearProfileAvatar(user.id, at);
      await store.addAudit({ id: operationId(context, 'audit'), actorId: user.id, action, targetType: 'user', targetId: user.id, at });
      return { user: selfUser(updated) };
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
        items: await publicActivities(page.items, {}, at),
        nextCursor: page.nextCursor || null
      };
    }

    if (action === 'companion.presence.snapshot') {
      const { scene } = validateCompanionPresenceInput(input);
      invariant(scene === 'companion_globe', 'VALIDATION_ERROR');
      return companionSnapshot(context && context.actorId, at);
    }

    if (action === 'companion.directory.snapshot') {
      const { scene, etag } = validateCompanionDirectorySnapshotInput(input);
      invariant(scene === 'companion_globe', 'VALIDATION_ERROR');
      return companionDirectorySnapshot(context && context.actorId, at, etag);
    }

    if (action === 'companion.directory.profile.nav.create') {
      const viewer = await requireActiveUser(context, false);
      const { displayToken } = validateCompanionDirectoryNavInput(input);
      const page = await store.snapshotCompanionDirectory(COMPANION_DIRECTORY_SAMPLE_LIMIT);
      const target = resolveCompanionDirectoryUser(page.items, displayToken, at);
      invariant(target, 'NOT_FOUND');
      if (target.id === viewer.id) return { target: 'self' };
      const issued = createDirectoryProfileNavTicket({
        viewerId: viewer.id,
        targetUserId: target.id,
        at
      });
      await store.createPublicProfileNavTicket(issued.ticket);
      return { target: 'public', profileNavToken: issued.profileNavToken, expiresAt: issued.expiresAt };
    }

    if (action === 'companion.presence.enter') {
      validateCompanionPresenceInput(input);
      const user = await requireActiveUser(context, false);
      const id = companionPresenceId(user.id);
      const sessionNonce = stableEntityId('presenceSession', idGenerator(), at);
      const profileNavNonce = createProfileNavNonce(idGenerator(), at);
      const expiresAt = new Date(Date.parse(at) + COMPANION_PRESENCE_TTL_MS).toISOString();
      await store.enterCompanionPresence({
        id,
        scene: 'companion_globe',
        userId: user.id,
        nickname: safePresenceNickname(user.profile && user.profile.nickname),
        sessionNonce,
        profileNavNonce,
        layoutSeed: layoutSeedForPresence(sessionNonce),
        status: 'ACTIVE',
        lastSeenAt: at,
        expiresAt,
        updatedAt: at
      });
      return {
        joined: true,
        sessionToken: sessionNonce,
        sessionTtlSec: COMPANION_PRESENCE_TTL_MS / 1000,
        heartbeatIntervalSec: COMPANION_HEARTBEAT_INTERVAL_MS / 1000,
        snapshot: await companionSnapshot(user.id, at)
      };
    }

    if (action === 'companion.presence.heartbeat') {
      const { sessionToken } = validateCompanionPresenceInput(input, { requireSessionToken: true });
      const user = await requireKnownUser(context);
      if (user.status !== 'ACTIVE') {
        await store.leaveCompanionPresence(companionPresenceId(user.id), sessionToken, at);
        invariant(false, 'ACCOUNT_DISABLED');
      }
      const expiresAt = new Date(Date.parse(at) + COMPANION_PRESENCE_TTL_MS).toISOString();
      const result = await store.heartbeatCompanionPresence(
        companionPresenceId(user.id), sessionToken, at, expiresAt, COMPANION_MIN_WRITE_INTERVAL_MS
      );
      return {
        joined: Boolean(result.presence),
        refreshed: result.refreshed === true,
        serverNow: at,
        sessionTtlSec: COMPANION_PRESENCE_TTL_MS / 1000,
        heartbeatIntervalSec: COMPANION_HEARTBEAT_INTERVAL_MS / 1000
      };
    }

    if (action === 'companion.presence.leave') {
      const { sessionToken } = validateCompanionPresenceInput(input, { requireSessionToken: true });
      const user = await requireKnownUser(context);
      await store.leaveCompanionPresence(companionPresenceId(user.id), sessionToken, at);
      return { joined: false, serverNow: at };
    }

    if (action === 'activity.nearby') {
      const filters = validateActivityNearbyInput(input);
      const page = await store.listNearbyActivities(filters, at);
      return {
        items: await publicActivities(page.items, {}, at),
        nextCursor: page.nextCursor === null || page.nextCursor === undefined
          ? null
          : encodeNearbyCursor(filters, page.nextCursor)
      };
    }

    if (action === 'activity.memories') {
      const { limit } = validateActivityMemoriesInput(input);
      const items = await store.listActivityMemories(limit, at);
      return { items: await publicActivities(items, {}, at) };
    }

    if (action === 'activity.detail') {
      const activityId = validateId(input && input.activityId, '活动ID');
      const storedActivity = await store.getActivity(activityId);
      const activity = normalizeActivityForRead(storedActivity, at);
      invariant(activity, 'NOT_FOUND');
      invariant(activity.status !== ACTIVITY_STATUS.SUSPENDED, 'TAKEDOWN');
      const actorId = context && context.actorId;
      const viewer = actorId ? await store.getViewerContext(activityId, actorId) : {};
      return { activity: await onePublicActivity(activity, viewer, at) };
    }

    if (action === 'community.post.list') {
      const payload = validateCommunityListInput(input);
      const page = await store.listCommunityPosts(payload);
      const actorId = context && context.actorId;
      const targets = page.items.map((item) => ({ targetType: 'post', targetId: item.id }));
      const likeStates = actorId ? await store.getCommunityLikeStates(actorId, targets) : {};
      const profilesByUserId = await communityAuthorProfiles(page.items);
      return {
        items: page.items.map((item) => publicCommunityPost(item, actorId, likeStates[`post:${item.id}`], profilesByUserId)),
        nextCursor: page.nextCursor || null
      };
    }

    if (action === 'community.post.detail') {
      const postId = validateId(input && input.postId, '帖子ID');
      const post = await store.getCommunityPost(postId);
      invariant(post && post.status === COMMUNITY_POST_STATUS.ACTIVE, post && post.status === COMMUNITY_POST_STATUS.SUSPENDED ? 'TAKEDOWN' : 'NOT_FOUND');
      const replyInput = validateCommunityListInput({ cursor: input && input.cursor, limit: input && input.limit || 30 });
      const page = await store.listCommunityReplies(postId, replyInput);
      const actorId = context && context.actorId;
      const targets = [{ targetType: 'post', targetId: post.id }, ...page.items.map((item) => ({ targetType: 'reply', targetId: item.id }))];
      const likeStates = actorId ? await store.getCommunityLikeStates(actorId, targets) : {};
      const replyTargetsById = await communityReplyTargets(page.items);
      const profilesByUserId = await communityAuthorProfiles([post, ...page.items, ...replyTargetsById.values()]);
      return {
        post: publicCommunityPost(post, actorId, likeStates[`post:${post.id}`], profilesByUserId),
        replies: page.items.map((item) => publicCommunityReply(item, actorId, likeStates[`reply:${item.id}`], profilesByUserId, replyTargetsById)),
        nextCursor: page.nextCursor || null
      };
    }

    if (action === 'community.profile.nav.create') {
      const viewer = await requireActiveUser(context, false);
      const payload = validateCommunityProfileNavCreateInput(input);
      const source = payload.sourceType === 'post'
        ? await store.getCommunityPost(payload.sourceId)
        : await store.getCommunityReply(payload.sourceId);
      invariant(source && source.status === (payload.sourceType === 'post' ? COMMUNITY_POST_STATUS.ACTIVE : COMMUNITY_REPLY_STATUS.ACTIVE), 'NOT_FOUND');
      if (payload.sourceType === 'reply') {
        const parent = await store.getCommunityPost(source.postId);
        invariant(parent && parent.status === COMMUNITY_POST_STATUS.ACTIVE, 'NOT_FOUND');
      }
      const target = await store.getUser(source.authorId);
      invariant(target && target.status === 'ACTIVE' && target.profile, 'NOT_FOUND');
      if (target.id === viewer.id) return { target: 'self' };
      const issued = createCommunityProfileNavTicket({
        viewerId: viewer.id,
        targetUserId: target.id,
        sourceType: payload.sourceType,
        sourceId: payload.sourceId,
        at
      });
      await store.createPublicProfileNavTicket(issued.ticket);
      return { target: 'public', profileNavToken: issued.profileNavToken, expiresAt: issued.expiresAt };
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
      const createdPost = await store.createCommunityPost(post, audit);
      const profilesByUserId = await communityAuthorProfiles([createdPost]);
      return { post: publicCommunityPost(createdPost, user.id, false, profilesByUserId) };
    }

    if (action === 'community.reply.create') {
      const user = await requireActiveUser(context);
      invariant(isCompleteRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先完善个人资料');
      const payload = validateCommunityReplyCreateInput(input);
      const post = await store.getCommunityPost(payload.postId);
      invariant(post && post.status === COMMUNITY_POST_STATUS.ACTIVE, 'NOT_FOUND');
      const targetReply = payload.replyToId ? await store.getCommunityReply(payload.replyToId) : null;
      // Only existing/idempotent replies may render an unavailable target; a new write is still rejected by the Store transaction.
      const activeTargetReply = targetReply && targetReply.status === COMMUNITY_REPLY_STATUS.ACTIVE && targetReply.postId === payload.postId
        ? targetReply
        : null;
      await moderation.check([payload.content], { actorId: user.id, scene: 2 });
      await store.consumeCommunityRateLimit(user.id, 'reply', at, 15, 10 * 60 * 1000);
      const reply = {
        id: operationId(context, `communityReply:${payload.postId}`),
        postId: payload.postId,
        authorId: user.id,
        author: { nickname: user.profile.nickname, avatarKind: avatarKindFromGender(user.profile.gender) },
        content: payload.content,
        ...(payload.replyToId ? { replyToId: payload.replyToId } : {}),
        status: COMMUNITY_REPLY_STATUS.ACTIVE,
        submissionKeyHash: operationId(context, 'submission'),
        payloadHash: context.payloadHash,
        createdAt: at,
        updatedAt: at
      };
      const audit = { id: operationId(context, 'audit'), actorId: user.id, action, targetType: 'communityReply', targetId: reply.id, at };
      const recipientId = activeTargetReply ? activeTargetReply.authorId : post.authorId;
      const activity = recipientId !== user.id ? {
        id: communityReplyActivityId(reply.id),
        type: COMMUNITY_ACTIVITY_TYPES.POST_REPLIED,
        status: COMMUNITY_ACTIVITY_STATUS.ACTIVE,
        recipientId,
        postId: post.id,
        replyId: reply.id,
        actorId: user.id,
        actor: reply.author,
        read: false,
        readAt: null,
        createdAt: at,
        updatedAt: at
      } : null;
      const createdReply = await store.createCommunityReply(reply, audit, activity);
      const updatedPost = await store.getCommunityPost(payload.postId);
      const replyTargetsById = targetReply ? new Map([[targetReply.id, targetReply]]) : new Map();
      const profilesByUserId = await communityAuthorProfiles([createdReply, targetReply].filter(Boolean));
      return { reply: publicCommunityReply(createdReply, user.id, false, profilesByUserId, replyTargetsById), replyCount: Number(updatedPost && updatedPost.replyCount || 0) };
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
      const deletedReply = await store.deleteCommunityReply(replyId, user.id, at, audit);
      const updatedPost = await store.getCommunityPost(deletedReply.postId);
      return { deleted: true, replyId, replyCount: Number(updatedPost && updatedPost.replyCount || 0) };
    }

    if (action === 'community.like.set') {
      const user = await requireActiveUser(context);
      invariant(isCompleteRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先完善个人资料');
      const payload = validateCommunityLikeInput(input);
      const audit = { id: operationId(context, 'audit'), actorId: user.id, action, targetType: payload.targetType === 'post' ? 'communityPost' : 'communityReply', targetId: payload.targetId, at };
      const target = payload.targetType === 'post'
        ? await store.getCommunityPost(payload.targetId)
        : await store.getCommunityReply(payload.targetId);
      const postId = target && (payload.targetType === 'post' ? target.id : target.postId);
      const activity = target && target.authorId !== user.id ? {
        id: payload.targetType === 'post'
          ? communityLikeActivityId(target.authorId, target.id)
          : communityReplyLikeActivityId(target.authorId, target.id),
        type: payload.targetType === 'post' ? COMMUNITY_ACTIVITY_TYPES.POST_LIKED : COMMUNITY_ACTIVITY_TYPES.REPLY_LIKED,
        status: COMMUNITY_ACTIVITY_STATUS.ACTIVE,
        recipientId: target.authorId,
        postId,
        ...(payload.targetType === 'reply' ? { replyId: target.id } : {}),
        actor: { nickname: user.profile.nickname, avatarKind: avatarKindFromGender(user.profile.gender) },
        actorCount: 0,
        recentActors: [],
        read: false,
        readAt: null,
        createdAt: at,
        updatedAt: at
      } : null;
      return store.setCommunityLikeAtomic({ ...payload, actorId: user.id, at, audit, activity });
    }

    if (action === 'community.activity.list') {
      const user = await requireActiveUser(context, false);
      const payload = validateCommunityActivityListInput(input);
      const cutoff = new Date(Date.parse(at) - 30 * 24 * 60 * 60 * 1000).toISOString();
      const page = await store.listCommunityActivities(user.id, { ...payload, cutoff });
      const posts = await Promise.all(page.items.map((item) => store.getCommunityPost(item.postId)));
      const replies = await Promise.all(page.items.map((item) => item.replyId ? store.getCommunityReply(item.replyId) : null));
      const actorItems = page.items.flatMap((item) => [COMMUNITY_ACTIVITY_TYPES.POST_LIKED, COMMUNITY_ACTIVITY_TYPES.REPLY_LIKED].includes(item.type)
        ? item.recentActors || []
        : item.actorId ? [{ actorId: item.actorId, author: item.actor }] : [])
        .map((item) => ({ authorId: item.actorId, author: item.author }));
      const profilesByUserId = await communityAuthorProfiles(actorItems);
      return {
        items: page.items.map((item, index) => publicCommunityActivity(item, posts[index], replies[index], profilesByUserId)),
        nextCursor: page.nextCursor || null
      };
    }

    if (action === 'community.activity.unread') {
      const user = await requireActiveUser(context, false);
      validateCommunityActivityUnreadInput(input);
      const cutoff = new Date(Date.parse(at) - 30 * 24 * 60 * 60 * 1000).toISOString();
      return store.countUnreadCommunityActivities(user.id, { cutoff });
    }

    if (action === 'community.activity.read') {
      const user = await requireActiveUser(context, false);
      const payload = validateCommunityActivityReadInput(input);
      const activity = await store.markCommunityActivityRead(payload.activityId, user.id, at, payload);
      return {
        activityId: payload.activityId,
        read: activity.read === true,
        readAt: activity.readAt || null,
        updatedAt: activity.updatedAt,
        stale: activity.stale === true
      };
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
      const combined = [...result.owned, ...result.joined];
      const viewers = [
        ...result.owned.map(() => ({ role: 'owner' })),
        ...result.joined.map(() => ({ role: 'member' }))
      ];
      const visible = await publicActivities(combined, viewers, at);
      return {
        owned: visible.slice(0, result.owned.length),
        joined: visible.slice(result.owned.length)
      };
    }

    if (action === 'activity.create') {
      const user = await requireActiveUser(context, true);
      const payload = validateActivityInput(input, clock());
      const activityPayload = payload;
      await moderation.check([
        activityPayload.title,
        activityPayload.description,
        activityPayload.rules,
        activityPayload.meetingPoint && activityPayload.meetingPoint.label,
        activityPayload.meetingPoint && activityPayload.meetingPoint.address
      ].filter(Boolean), { actorId: user.id, scene: 2 });
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
      return { activity: await onePublicActivity(storedActivity, { role: 'owner' }, at) };
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
        activity: await onePublicActivity(result.activity, { role: 'owner' }, at),
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
        activity: await onePublicActivity(result.activity, { role: 'owner' }, at),
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
      return { activity: await onePublicActivity(result.activity, { role: 'member' }, at) };
    }

    if (action === 'activity.cancel') {
      const owner = await requireActiveUser(context);
      const activityId = validateId(input && input.activityId, '活动ID');
      const reason = stringValue(input && input.reason, '取消原因', { required: true, max: 120 });
      await moderation.check([reason], { actorId: owner.id, scene: 2 });
      const result = await store.cancelActivity(activityId, owner.id, reason, at);
      await store.addAudit({ id: operationId(context, 'audit'), actorId: owner.id, action, targetType: 'activity', targetId: activityId, at });
      return { activity: await onePublicActivity(result.activity, { role: 'owner' }, at) };
    }

    if (action === 'activity.complete') {
      const owner = await requireActiveUser(context);
      const activityId = validateId(input && input.activityId, '活动ID');
      const activity = await store.completeActivity(activityId, owner.id, at);
      await store.addAudit({ id: operationId(context, 'audit'), actorId: owner.id, action, targetType: 'activity', targetId: activityId, at });
      return { activity: await onePublicActivity(activity, { role: 'owner' }, at) };
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

    if (action === 'group.thread') {
      const user = await requireActiveUser(context);
      invariant(isCompleteRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先完善个人资料');
      const activityId = validateId(input && input.activityId, '活动ID');
      return store.getGroupThread(activityId, user.id);
    }

    if (action === 'group.message.list') {
      const user = await requireActiveUser(context);
      invariant(isCompleteRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先完善个人资料');
      const payload = validateGroupMessageListInput(input);
      const page = await store.listGroupMessages(payload.activityId, user.id, payload);
      return {
        generation: page.generation,
        writable: page.writable,
        items: page.items.map((item) => publicGroupMessage(item, user.id)),
        nextBefore: page.nextBefore
      };
    }

    if (action === 'group.message.send') {
      const user = await requireActiveUser(context);
      invariant(isCompleteRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先完善个人资料');
      const payload = validateGroupMessageCreateInput(input);
      const existing = await store.getGroupMessageForReplay(payload.activityId, user.id,
        payload.generation, payload.clientMessageId);
      if (existing) {
        invariant(existing.payloadHash === context.payloadHash, 'CONFLICT', '客户端消息ID已用于其他内容');
        return { message: publicGroupMessage(existing, user.id) };
      }
      await moderation.check([payload.text], { actorId: user.id, scene: 2 });
      await store.consumeCommunityRateLimit(user.id, 'groupMessage', at, 30, 10 * 60 * 1000);
      const message = await store.addGroupMessage({ ...payload, actorId: user.id,
        payloadHash: context.payloadHash, at });
      return { message: publicGroupMessage(message, user.id) };
    }

    if (action === 'group.message.read') {
      const user = await requireActiveUser(context);
      invariant(isCompleteRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先完善个人资料');
      const payload = validateGroupReadInput(input);
      const read = await store.markGroupRead(payload.activityId, user.id,
        payload.generation, payload.messageId, payload.sequence, at);
      return { generation: read.generation, sequence: read.sequence, readAt: read.updatedAt };
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
        kind: 'MEMBER_DM',
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

    if (action === 'dm.consult.create') {
      const user = await requireActiveUser(context);
      invariant(isCompleteRideProfile(user.profile), 'PROFILE_INCOMPLETE', '请先完善个人资料');
      const activityId = validateId(input && input.activityId, '活动ID');
      const relationship = await store.resolveConsultationPeer(activityId, user.id);
      const participantIds = [user.id, relationship.peerUserId].sort();
      const conversation = await store.upsertDirectConversation({
        id: stableEntityId('consultConversation', relationship.activity.id, ...participantIds),
        kind: 'OWNER_CONSULT',
        ownerId: relationship.peerUserId,
        consultantId: user.id,
        participantAId: participantIds[0],
        participantBId: participantIds[1],
        source: { type: 'activity_consult', id: relationship.activity.id, title: relationship.activity.title || '' },
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
      if (conversation.kind === 'OWNER_CONSULT') {
        invariant(sourceActivity && sourceActivity.status !== ACTIVITY_STATUS.SUSPENDED,
          sourceActivity && sourceActivity.status === ACTIVITY_STATUS.SUSPENDED ? 'TAKEDOWN' : 'NOT_FOUND_OR_NOT_ALLOWED');
      }
      const messageId = stableEntityId('directMessage', conversation.id, user.id, payload.clientMessageId);
      const existing = await store.getDirectMessage(messageId);
      if (existing) {
        invariant(existing.conversationId === conversation.id && existing.senderId === user.id, 'CONFLICT', '客户端消息ID已用于其他会话');
        invariant(existing.payloadHash === context.payloadHash, 'CONFLICT', '客户端消息ID已用于其他内容');
        // Replay is a read of an already accepted message, not a new send/quota charge.
        return { message: publicDirectMessage(existing, user.id) };
      }
      const canSend = conversation.kind === 'OWNER_CONSULT'
        ? sourceActivity && [ACTIVITY_STATUS.RECRUITING, ACTIVITY_STATUS.FORMED, ACTIVITY_STATUS.IN_PROGRESS].includes(sourceActivity.status)
        : sourceActivity && [ACTIVITY_STATUS.FORMED, ACTIVITY_STATUS.IN_PROGRESS].includes(sourceActivity.status);
      invariant(canSend, 'CONFLICT', conversation.kind === 'OWNER_CONSULT'
        ? '活动已结束，这段咨询现为只读' : '共同活动已结束，这段私信现为只读');
      await moderation.check([payload.text], { actorId: user.id, scene: 2 });
      await store.consumeCommunityRateLimit(user.id, 'directMessage', at, 30, 10 * 60 * 1000);
      const message = await store.addDirectMessage({
        id: messageId,
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
      return { activity: await onePublicActivity(activity, { role: 'admin' }, at) };
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
        if (['companion.presence.heartbeat', 'companion.presence.leave'].includes(action)) await requireKnownUser(context);
        else await requireActiveUser(context, false);
        const actorId = requireActor(context);
        const key = requireIdempotencyKey(event.idempotencyKey);
        const payloadHash = crypto.createHash('sha256').update(stableSerialize(input)).digest('hex');
        const cacheAction = PAYLOAD_BOUND_IDEMPOTENT_ACTIONS.has(action) ? `${action}:${payloadHash}` : action;
        const cached = BUSINESS_IDEMPOTENT_ACTIONS.has(action) ? null : await store.getIdempotency(actorId, cacheAction, key);
        if (cached) return { ok: true, data: await refreshCachedActivity(cached, context, nowIso()), requestId, idempotentReplay: true };
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
  publicCommunityActivity,
  publicNotification,
  selfUser,
  publicCompanionProfile
};
