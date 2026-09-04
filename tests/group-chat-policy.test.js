'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  beginGroupMembership, resolveGroupAccess, assertGroupMessageVisible,
  groupHistoryPage, groupUnread, groupMessageId
} = require('../cloudfunctions/api/lib/group-chat-policy');

function fixture() {
  const activity = { id: 'activity', status: 'RECRUITING', groupSequence: 4 };
  const user = { id: 'actor', status: 'ACTIVE', profile: { adultConfirmed: true, gender: 'FEMALE' } };
  const member = { id: 'member', activityId: activity.id, userId: user.id, status: 'ACTIVE', groupWindow: { generation: 1, after: 2 } };
  return { activity, user, member };
}
const message = (sequence, fields = {}) => ({ id: `message-${sequence}`, activityId: 'activity', sequence, text: '一起出发', senderId: 'peer', createdAt: '2026-09-04T00:00:00.000Z', ...fields });
const denied = (fn, code = 'FORBIDDEN') => assert.throws(fn, { code });

test('加入边界由服务端序号确定，不依赖同毫秒时间戳', () => {
  const { activity } = fixture();
  const window = beginGroupMembership(activity);
  assert.deepEqual(window, { generation: 1, after: 4 });
  assert.deepEqual(activity, { id: 'activity', status: 'RECRUITING', groupSequence: 4 });
});

test('重新加入提高周期并截断本次加入前全部历史，包括上次成员期间', () => {
  const f = fixture();
  const previous = structuredClone(f.member);
  f.member.groupWindow = beginGroupMembership(f.activity, f.member.groupWindow);
  assert.deepEqual(f.member.groupWindow, { generation: 2, after: 4 });
  assert.deepEqual(previous.groupWindow, { generation: 1, after: 2 });
  f.activity.groupSequence = 5;
  const access = resolveGroupAccess(f);
  for (const sequence of [1, 2, 3, 4]) denied(() => assertGroupMessageVisible(access, message(sequence)));
  assert.equal(assertGroupMessageVisible(access, message(5)).id, 'message-5');
});

test('账号、资料、当前成员归属、下架和缺失边界都fail-closed', () => {
  for (const mutate of [
    f => { f.member.status = 'LEFT'; },
    f => { f.member.userId = 'other'; },
    f => { f.member.activityId = 'other'; },
    f => { f.member.groupWindow = null; },
    f => { f.member.groupWindow.after = -1; },
    f => { f.member.groupWindow.after = 5; },
    f => { f.member.groupWindow.generation = 0; },
    f => { f.member.groupWindow.generation = Number.MAX_SAFE_INTEGER; }
  ]) { const f = fixture(); mutate(f); denied(() => resolveGroupAccess(f)); }
  const disabled = fixture(); disabled.user.status = 'DISABLED';
  denied(() => resolveGroupAccess(disabled), 'ACCOUNT_DISABLED');
  const incomplete = fixture(); incomplete.user.profile.adultConfirmed = false;
  denied(() => resolveGroupAccess(incomplete), 'PROFILE_INCOMPLETE');
  const suspended = fixture(); suspended.activity.status = 'SUSPENDED';
  denied(() => resolveGroupAccess(suspended), 'TAKEDOWN');
  const draft = fixture(); draft.activity.status = 'DRAFT';
  denied(() => resolveGroupAccess(draft));
  for (const id of [undefined, null, '', ' ', 123]) {
    const f = fixture(); f.activity.id = id; f.member.activityId = id;
    denied(() => resolveGroupAccess(f), 'NOT_FOUND');
  }
});

test('只有进行中的有效成员可写；终态有效成员只读，退出成员连历史也不能读', () => {
  for (const status of ['RECRUITING', 'FORMED', 'IN_PROGRESS']) {
    const f = fixture(); f.activity.status = status;
    assert.equal(resolveGroupAccess({ ...f, write: true }).writable, true);
  }
  for (const status of ['COMPLETED', 'CANCELLED', 'EXPIRED']) {
    const f = fixture(); f.activity.status = status;
    assert.equal(resolveGroupAccess(f).writable, false);
    denied(() => resolveGroupAccess({ ...f, write: true }), 'CONFLICT');
    f.member.status = 'LEFT';
    denied(() => resolveGroupAccess(f));
  }
});

test('成员窗口丢失、损坏、倒退或序号耗尽不能静默恢复从0读取', () => {
  for (const groupSequence of [undefined, null, -1, NaN, 1.5, '4', Number.MAX_SAFE_INTEGER]) {
    denied(() => beginGroupMembership({ id: 'activity', groupSequence }), 'CONFLICT');
  }
  for (const previous of [{}, { generation: 0, after: 1 }, { generation: 1, after: 8 }, { generation: Number.MAX_SAFE_INTEGER, after: 1 }, { generation: Number.MAX_SAFE_INTEGER - 1, after: 1 }]) {
    denied(() => beginGroupMembership({ groupSequence: 4 }, previous), 'CONFLICT');
  }
  assert.deepEqual(beginGroupMembership({ groupSequence: 0 }), { generation: 1, after: 0 });
});

test('分页先过滤不可见历史：伪造游标、跨活动消息和未来消息不能越权', () => {
  const access = resolveGroupAccess(fixture());
  const rows = [message(1), message(2), message(3), message(4), message(5), message(4, { activityId: 'other' })];
  const page = groupHistoryPage(access, rows, { limit: 1 });
  assert.deepEqual(page.items.map(item => item.id), ['message-4']);
  assert.equal(page.nextBefore, 4);
  const next = groupHistoryPage(access, rows, { limit: 1, before: page.nextBefore });
  assert.deepEqual(next.items.map(item => item.id), ['message-3']);
  assert.equal(next.nextBefore, null);
  assert.deepEqual(groupHistoryPage(access, rows, { before: 2 }).items, []);
  assert.equal(groupHistoryPage(access, rows, { before: 999 }).items.length, 2);
  for (const before of [-1, NaN, 1.1, '4']) denied(() => groupHistoryPage(access, rows, { before }), 'VALIDATION_ERROR');
  for (const limit of [0, -1, 101, NaN]) denied(() => groupHistoryPage(access, rows, { limit }), 'VALIDATION_ERROR');
});

test('未读和预览不得使用加入前摘要，旧周期已读标记不能抹掉新周期未读', () => {
  const access = resolveGroupAccess(fixture());
  assert.equal(groupUnread(access, message(2), null), false);
  assert.equal(groupUnread(access, message(4), { generation: 0, sequence: 999 }), true);
  assert.equal(groupUnread(access, message(4), { generation: 1, sequence: 4 }), false);
  assert.equal(groupUnread(access, message(4), { generation: 1, sequence: 999 }), true);
  denied(() => assertGroupMessageVisible(access, message(2)));
});

test('发消息ID绑定本次成员周期，旧页面不能以旧周期发送', () => {
  const access = resolveGroupAccess(fixture());
  const id = groupMessageId(access, 1, 'client-message');
  assert.equal(id, groupMessageId(access, 1, 'client-message'));
  assert.notEqual(id, groupMessageId({ ...access, generation: 2 }, 2, 'client-message'));
  denied(() => groupMessageId(access, 0, 'client-message'), 'CONFLICT');
  denied(() => groupMessageId(access, 1, ''), 'VALIDATION_ERROR');
  assert.equal(id.includes('actor'), false);
});
