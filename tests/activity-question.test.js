'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createPinbaService } = require('../cloudfunctions/api/lib/service');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');

const NOW = '2026-08-24T09:00:00.000Z';

function user(id, nickname, overrides = {}) {
  return {
    id,
    role: 'user',
    status: 'ACTIVE',
    profile: nickname ? {
      nickname,
      city: '上海',
      interests: [],
      adultConfirmed: true
    } : null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function activity(overrides = {}) {
  return {
    id: 'activity-qa',
    ownerId: 'owner-openid',
    owner: { nickname: '发起者' },
    type: 'buddy',
    title: '公开问答测试活动',
    description: '用于验证公开问答',
    city: '上海',
    district: '杨浦区',
    placeLabel: '五角场',
    startsAt: '2026-08-25T10:00:00.000Z',
    deadlineAt: '2026-08-25T08:00:00.000Z',
    targetMembers: 4,
    memberCount: 1,
    contactInfo: '内部微信号不应公开',
    rules: '',
    typeData: { category: '运动', costMode: 'AA', level: 'BEGINNER', equipment: '' },
    status: 'RECRUITING',
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function question(index, overrides = {}) {
  const minute = String(index).padStart(2, '0');
  return {
    id: `question-${index}`,
    activityId: 'activity-qa',
    askerId: 'member-openid',
    asker: { nickname: '参与者' },
    content: `公开问题 ${index}`,
    answer: index % 2 === 0 ? {
      responderId: 'owner-openid',
      responder: { nickname: '发起者' },
      content: `公开回答 ${index}`,
      answeredAt: `2026-08-24T09:${minute}:30.000Z`,
      operationKeyHash: `private-answer-hash-${index}`
    } : null,
    submissionKeyHash: `private-question-hash-${index}`,
    createdAt: `2026-08-24T09:${minute}:00.000Z`,
    updatedAt: `2026-08-24T09:${minute}:30.000Z`,
    moderation: { provider: 'private-provider' },
    ...overrides
  };
}

function setup(overrides = {}) {
  const store = new MemoryStore({
    users: [
      user('owner-openid', '发起者'),
      user('member-openid', '参与者'),
      user('other-openid', '路人'),
      user('profileless-openid', ''),
      user('disabled-openid', '受限账号', { status: 'DISABLED' })
    ],
    activities: [activity(overrides.activity)],
    activityQuestions: overrides.questions || []
  });
  let request = 0;
  const service = createPinbaService({
    store,
    clock: () => new Date(NOW),
    idGenerator: () => `generated-${++request}`
  });
  async function call(action, data = {}, actorId = null, idempotencyKey) {
    request += 1;
    return service.execute({
      action,
      data,
      requestId: `qa-request-${request}`,
      ...(idempotencyKey ? { idempotencyKey } : {})
    }, actorId ? { actorId } : {});
  }
  return { store, call };
}

test('游客可分页读取最多 10 条公开问答且 DTO 不泄露内部身份与审核字段', async () => {
  const seeded = Array.from({ length: 12 }, (_, index) => question(index));
  const { call } = setup({ questions: seeded });

  const first = await call('activity.question.list', { activityId: 'activity-qa', limit: 50 });
  assert.equal(first.ok, true);
  assert.equal(first.data.items.length, 10);
  assert.equal(first.data.nextCursor, '10');
  assert.deepEqual(first.data.items.map((item) => item.id), [
    'question-11', 'question-10', 'question-9', 'question-8', 'question-7',
    'question-6', 'question-5', 'question-4', 'question-3', 'question-2'
  ]);

  const serialized = JSON.stringify(first.data);
  assert.equal(serialized.includes('member-openid'), false);
  assert.equal(serialized.includes('owner-openid'), false);
  assert.equal(serialized.includes('private-'), false);
  assert.equal(serialized.includes('moderation'), false);
  assert.equal(serialized.includes('contactInfo'), false);
  assert.equal(serialized.includes('内部微信号不应公开'), false);

  const second = await call('activity.question.list', {
    activityId: 'activity-qa',
    cursor: first.data.nextCursor,
    limit: 10
  });
  assert.deepEqual(second.data.items.map((item) => item.id), ['question-1', 'question-0']);
  assert.equal(second.data.nextCursor, null);
});

test('active 用户可提问且同一幂等键重放不重复创建', async () => {
  const { call, store } = setup();
  const input = { activityId: 'activity-qa', content: '可以带一个小行李箱吗？' };
  const first = await call('activity.question.ask', input, 'profileless-openid', 'ask-question-key-001');
  const replay = await call('activity.question.ask', input, 'profileless-openid', 'ask-question-key-001');
  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(store.activityQuestions.size, 1);
  assert.equal(first.data.question.asker, null);
  assert.equal(JSON.stringify(first.data).includes('profileless-openid'), false);
});

test('问题与回答在内容安全拒绝时均不落库', async () => {
  const { call, store } = setup();
  const rejectedQuestion = await call('activity.question.ask', {
    activityId: 'activity-qa',
    content: '请先付定金再回答'
  }, 'member-openid', 'ask-rejected-key-001');
  assert.equal(rejectedQuestion.ok, false);
  assert.equal(rejectedQuestion.error.code, 'CONTENT_REJECTED');
  assert.equal(store.activityQuestions.size, 0);

  store.activityQuestions.set('question-existing', question(1, { id: 'question-existing', answer: null }));
  const rejectedAnswer = await call('activity.question.answer', {
    activityId: 'activity-qa',
    questionId: 'question-existing',
    content: '需要先付定金'
  }, 'owner-openid', 'answer-rejected-key-001');
  assert.equal(rejectedAnswer.ok, false);
  assert.equal(rejectedAnswer.error.code, 'CONTENT_REJECTED');
  assert.equal(store.activityQuestions.get('question-existing').answer, null);
});

test('仅发起者可回答且不同幂等键并发二答只成功一次', async () => {
  const { call, store } = setup({ questions: [question(1, { id: 'question-race', answer: null })] });
  const input = {
    activityId: 'activity-qa',
    questionId: 'question-race',
    content: '可以，现场空间足够。'
  };

  const outsider = await call('activity.question.answer', input, 'other-openid', 'answer-outsider-key-001');
  assert.equal(outsider.ok, false);
  assert.equal(outsider.error.code, 'FORBIDDEN');

  const [first, second] = await Promise.all([
    call('activity.question.answer', input, 'owner-openid', 'answer-race-key-001'),
    call('activity.question.answer', { ...input, content: '另一个回答' }, 'owner-openid', 'answer-race-key-002')
  ]);
  assert.equal([first, second].filter((result) => result.ok).length, 1);
  assert.equal([first, second].filter((result) => !result.ok && result.error.code === 'CONFLICT').length, 1);
  assert.equal(store.activityQuestions.get('question-race').answer.content, '可以，现场空间足够。');
});

test('问答状态矩阵与下架 Fail-closed 契约生效', async () => {
  const { call, store } = setup({ questions: [question(1, { id: 'question-state', answer: null })] });

  store.activities.get('activity-qa').status = 'EXPIRED';
  const expiredList = await call('activity.question.list', { activityId: 'activity-qa' });
  const expiredAsk = await call('activity.question.ask', {
    activityId: 'activity-qa', content: '过期后不能提问'
  }, 'member-openid', 'ask-expired-key-001');
  const expiredAnswer = await call('activity.question.answer', {
    activityId: 'activity-qa', questionId: 'question-state', content: '过期后不能回答'
  }, 'owner-openid', 'answer-expired-key-001');
  assert.equal(expiredList.ok, true);
  assert.equal(expiredAsk.error.code, 'CONFLICT');
  assert.equal(expiredAnswer.error.code, 'CONFLICT');

  store.activities.get('activity-qa').status = 'IN_PROGRESS';
  const inProgressAnswer = await call('activity.question.answer', {
    activityId: 'activity-qa', questionId: 'question-state', content: '进行中仍可回答'
  }, 'owner-openid', 'answer-progress-key-001');
  assert.equal(inProgressAnswer.ok, true);

  store.activities.get('activity-qa').status = 'SUSPENDED';
  const suspendedList = await call('activity.question.list', { activityId: 'activity-qa' });
  const suspendedAsk = await call('activity.question.ask', {
    activityId: 'activity-qa', content: '下架后先付定金也必须统一收敛'
  }, 'member-openid', 'ask-suspended-key-001');
  const suspendedAnswer = await call('activity.question.answer', {
    activityId: 'activity-qa', questionId: 'question-state', content: '先付定金'
  }, 'owner-openid', 'answer-suspended-key-001');
  assert.equal(suspendedList.error.code, 'TAKEDOWN');
  assert.equal(suspendedAsk.error.code, 'TAKEDOWN');
  assert.equal(suspendedAnswer.error.code, 'TAKEDOWN');
  assert.equal(JSON.stringify(suspendedList).includes('公开问题'), false);
});

test('DRAFT/CANCELLED/COMPLETED/FORMED 状态遵守问答读写矩阵', async () => {
  const { call, store } = setup({ questions: [question(1, { id: 'question-matrix', answer: null })] });

  store.activities.get('activity-qa').status = 'DRAFT';
  assert.equal((await call('activity.question.list', { activityId: 'activity-qa' })).error.code, 'NOT_FOUND');
  assert.equal((await call('activity.question.ask', {
    activityId: 'activity-qa', content: '草稿不能提问'
  }, 'member-openid', 'ask-draft-key-001')).error.code, 'CONFLICT');
  assert.equal((await call('activity.question.answer', {
    activityId: 'activity-qa', questionId: 'question-matrix', content: '草稿不能回答'
  }, 'owner-openid', 'answer-draft-key-001')).error.code, 'CONFLICT');

  store.activities.get('activity-qa').status = 'FORMED';
  assert.equal((await call('activity.question.ask', {
    activityId: 'activity-qa', content: '成团后仍可提问'
  }, 'member-openid', 'ask-formed-key-001')).ok, true);
  assert.equal((await call('activity.question.answer', {
    activityId: 'activity-qa', questionId: 'question-matrix', content: '成团后仍可回答'
  }, 'owner-openid', 'answer-formed-key-001')).ok, true);

  for (const status of ['CANCELLED', 'COMPLETED']) {
    store.activities.get('activity-qa').status = status;
    const questionId = `question-${status.toLowerCase()}`;
    store.activityQuestions.set(questionId, question(2, { id: questionId, answer: null }));
    assert.equal((await call('activity.question.list', { activityId: 'activity-qa' })).ok, true);
    assert.equal((await call('activity.question.ask', {
      activityId: 'activity-qa', content: `${status} 不能提问`
    }, 'member-openid', `ask-${status.toLowerCase()}-key-001`)).error.code, 'CONFLICT');
    assert.equal((await call('activity.question.answer', {
      activityId: 'activity-qa', questionId, content: `${status} 不能回答`
    }, 'owner-openid', `answer-${status.toLowerCase()}-key-001`)).error.code, 'CONFLICT');
  }
});

test('提问存储在事务边界内重新校验活动状态并原子写入审计', async () => {
  const { call, store } = setup();
  const originalCreate = store.createActivityQuestion.bind(store);
  store.createActivityQuestion = async (item, audit) => {
    store.activities.get(item.activityId).status = 'SUSPENDED';
    return originalCreate(item, audit);
  };
  const raced = await call('activity.question.ask', {
    activityId: 'activity-qa', content: '竞态期间不应落库'
  }, 'member-openid', 'ask-race-takedown-001');
  assert.equal(raced.error.code, 'TAKEDOWN');
  assert.equal(store.activityQuestions.size, 0);
  assert.equal(store.auditLogs.size, 0);
});

test('问答审计与业务写入使用 Store 原子边界而非事后 addAudit', async () => {
  const { call, store } = setup({ questions: [question(1, { id: 'question-audit', answer: null })] });
  store.addAudit = async () => { throw new Error('Q&A 不应调用事后审计'); };
  const asked = await call('activity.question.ask', {
    activityId: 'activity-qa', content: '审计与问题原子写入'
  }, 'member-openid', 'ask-atomic-audit-001');
  const answered = await call('activity.question.answer', {
    activityId: 'activity-qa', questionId: 'question-audit', content: '审计与回答原子写入'
  }, 'owner-openid', 'answer-atomic-audit-001');
  assert.equal(asked.ok, true);
  assert.equal(answered.ok, true);
  assert.equal(store.auditLogs.size, 2);
});

test('Mock 问答输入校验与真实服务保持 VALIDATION_ERROR 契约', async () => {
  const mockServer = require('../miniprogram/mocks/server');
  mockServer.reset();
  mockServer.setPersona('u_member');
  const invalidCases = [
    ['activity.question.list', { activityId: '' }],
    ['activity.question.list', { activityId: 'x'.repeat(81) }],
    ['activity.question.ask', { activityId: 'a_ride', content: '' }],
    ['activity.question.ask', { activityId: 'a_ride', content: 'x'.repeat(201) }],
    ['activity.question.answer', { activityId: 'a_ride', questionId: '', content: '回答' }],
    ['activity.question.answer', { activityId: 'a_ride', questionId: 'x'.repeat(81), content: '回答' }],
    ['activity.question.answer', { activityId: 'a_ride', questionId: 'q_ride_luggage', content: 'x'.repeat(301) }]
  ];
  for (const [action, data] of invalidCases) {
    const result = await mockServer.call({
      action,
      data,
      requestId: `validation-${action}`,
      ...(action.endsWith('.list') ? {} : { idempotencyKey: `validation-${action.replace(/\./g, '-')}` })
    });
    assert.equal(result.error.code, 'VALIDATION_ERROR');
  }
  mockServer.reset();
});

test('客户端对服务端 INTERNAL 写失败保留同一幂等键供安全重试', async () => {
  const mockServer = require('../miniprogram/mocks/server');
  const api = require('../miniprogram/services/api');
  const originalCall = mockServer.call;
  const keys = [];
  mockServer.call = async (event) => {
    keys.push(event.idempotencyKey);
    if (keys.length === 1) return { ok: false, error: { code: 'INTERNAL', message: '服务暂时不可用' } };
    return { ok: true, data: { question: { id: 'safe-replay' } } };
  };
  try {
    await assert.rejects(
      api.invoke('activity.question.ask', { activityId: 'activity-qa', content: '保留幂等键' }),
      (error) => error.code === 'INTERNAL'
    );
    await api.invoke('activity.question.ask', { activityId: 'activity-qa', content: '保留幂等键' });
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);
  } finally {
    mockServer.call = originalCall;
  }
});

test('受限账号不能通过旧问答幂等结果继续重放', async () => {
  const { call, store } = setup({ questions: [question(1, { id: 'question-disabled-answer', answer: null })] });
  const input = { activityId: 'activity-qa', content: '正常问题' };
  const first = await call('activity.question.ask', input, 'member-openid', 'ask-disabled-replay-001');
  assert.equal(first.ok, true);
  store.users.get('member-openid').status = 'DISABLED';
  const replay = await call('activity.question.ask', input, 'member-openid', 'ask-disabled-replay-001');
  assert.equal(replay.ok, false);
  assert.equal(replay.error.code, 'ACCOUNT_DISABLED');

  const answered = await call('activity.question.answer', {
    activityId: 'activity-qa', questionId: 'question-disabled-answer', content: '先完成一次回答'
  }, 'owner-openid', 'answer-disabled-replay-001');
  assert.equal(answered.ok, true);
  store.users.get('owner-openid').status = 'DISABLED';
  const answerReplay = await call('activity.question.answer', {
    activityId: 'activity-qa', questionId: 'question-disabled-answer', content: '先完成一次回答'
  }, 'owner-openid', 'answer-disabled-replay-001');
  assert.equal(answerReplay.error.code, 'ACCOUNT_DISABLED');
});

test('客户端与 Mock/Service 都把提问和回答识别为幂等写动作', () => {
  const api = require('../miniprogram/services/api');
  assert.equal(api.isMutatingAction('activity.question.ask'), true);
  assert.equal(api.isMutatingAction('activity.question.answer'), true);

  const serviceSource = fs.readFileSync(path.join(__dirname, '../cloudfunctions/api/lib/service.js'), 'utf8');
  const mockSource = fs.readFileSync(path.join(__dirname, '../miniprogram/mocks/server.js'), 'utf8');
  assert.match(serviceSource, /MUTATING_ACTIONS[\s\S]*activity\.question\.ask[\s\S]*activity\.question\.answer/);
  assert.match(mockSource, /MUTATING_ACTIONS[\s\S]*activity\.question\.ask[\s\S]*activity\.question\.answer/);
  assert.match(mockSource, /PUBLIC_ACTIONS[\s\S]*activity\.question\.list/);
});

test('Cloud 问答回答实现使用 doc-only 事务且不在事务内 where', () => {
  const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/api/lib/cloud-store.js'), 'utf8');
  assert.match(source, /createActivityQuestion[\s\S]*transaction\.collection\('activities'\)\.doc\(question\.activityId\)/);
  assert.match(source, /answerActivityQuestionAtomic[\s\S]*runTransaction/);
  assert.doesNotMatch(source, /transaction\.collection\([^)]*\)\s*\.where/s);
});
