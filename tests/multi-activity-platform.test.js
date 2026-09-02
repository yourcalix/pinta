'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateActivityInput, validateActivityListInput } = require('../cloudfunctions/api/lib/validation');
const { createPinbaService } = require('../cloudfunctions/api/lib/service');
const { MemoryStore } = require('../cloudfunctions/api/lib/memory-store');

const NOW = new Date('2026-08-23T02:00:00.000Z');

function common(type, typeData) {
  return {
    type,
    title: '周末一起活动',
    description: '面向所有成年用户的互助活动',
    city: '澳门',
    district: '澳门城区',
    placeLabel: '公共活动区域',
    startsAt: '2026-08-24T02:00:00.000Z',
    deadlineAt: '2026-08-23T14:00:00.000Z',
    minMembers: 2,
    maxMembers: 4,
    rules: '请守时并尊重其他成员',
    typeData
  };
}

test('新活动模型只接受拼同行、拼运动和拼饭桌', () => {
  assert.equal(validateActivityInput(common('companion', {
    originLabel: '校门口', destinationLabel: '横琴口岸', timeFlexibility: 'WITHIN_30_MIN',
    transportPreference: 'DISCUSS_AFTER_FORMED', luggageType: 'SMALL'
  }), NOW).type, 'companion');
  assert.equal(validateActivityInput(common('sport', {
    sportType: '羽毛球', venue: '校园体育馆', level: 'BEGINNER', intensity: 'LIGHT', equipment: '自带球拍'
  }), NOW).type, 'sport');
  assert.equal(validateActivityInput(common('food', {
    venue: '学生餐厅', cuisine: '粤菜', budgetRange: '50以内', dietaryNotes: '不吃辣'
  }), NOW).type, 'food');
  assert.throws(() => validateActivityInput(common('ride', {}), NOW), (error) => error.code === 'VALIDATION_ERROR');
  assert.throws(() => validateActivityListInput({ type: 'driver' }), (error) => error.code === 'VALIDATION_ERROR');
});

test('新活动不接收司机、车辆或公开联系方式字段', () => {
  const value = validateActivityInput({
    ...common('sport', {
      sportType: '篮球', venue: '校内球场', level: 'INTERMEDIATE', intensity: 'MEDIUM', equipment: ''
    }),
    driverId: 'driver-1',
    vehicleId: 'vehicle-1',
    contactInfo: 'should-not-be-stored'
  }, NOW);
  assert.equal(value.driverId, undefined);
  assert.equal(value.vehicleId, undefined);
  assert.equal(value.contactInfo, undefined);
});

test('普通成年用户无需学生认证即可创建、申请和使用成员空间', async () => {
  const users = ['owner', 'member'].map((id) => ({ id, role: 'user', status: 'ACTIVE', profile: { nickname: `${id}用户`, gender: 'MALE', city: '澳门', interests: [], adultConfirmed: true } }));
  const store = new MemoryStore({ users });
  const service = createPinbaService({ store, clock: () => new Date(NOW) });
  let request = 0;
  const call = (action, data, actorId, key) => service.execute({ action, data, requestId: `multi-${++request}`, ...(key ? { idempotencyKey: key } : {}) }, { actorId });
  const created = await call('activity.create', common('sport', { sportType: '羽毛球', venue: '校园体育馆', level: 'ANY', intensity: 'LIGHT', equipment: '' }), 'owner', 'create-sport-001');
  assert.equal(created.ok, true);
  assert.equal(created.data.activity.type, 'sport');
  assert.equal(created.data.activity.maxMembers, 4);
  const applied = await call('application.submit', { activityId: created.data.activity.id, note: '我可以准时到', autoJoinConsent: true }, 'member', 'apply-sport-001');
  assert.equal(applied.ok, true);

  const ownerMine = await call('activity.mine', {}, 'owner');
  const memberMine = await call('activity.mine', {}, 'member');
  const ownerNotifications = await call('notification.list', {}, 'owner');
  assert.equal(ownerMine.ok, true);
  assert.equal(memberMine.ok, true);
  assert.equal(ownerNotifications.ok, true);

  const applications = await call('application.listForOwner', { activityId: created.data.activity.id }, 'owner');
  const approved = await call('application.approve', {
    activityId: created.data.activity.id,
    applicationId: applications.data.items[0].id
  }, 'owner', 'approve-sport-001');
  assert.equal(approved.ok, true);
  assert.equal(approved.data.activity.status, 'FORMED');

  const shared = await call('group.contact.share', {
    activityId: created.data.activity.id,
    type: 'WECHAT',
    value: 'pinba_member'
  }, 'member', 'share-contact-001');
  assert.equal(shared.ok, true);
  assert.deepEqual(shared.data.members.find((item) => item.isSelf).sharedContact, { type: 'WECHAT', value: 'pinba_member' });

  const revoked = await call('group.contact.revoke', { activityId: created.data.activity.id }, 'member', 'revoke-contact-001');
  assert.equal(revoked.ok, true);
  assert.equal(revoked.data.members.find((item) => item.isSelf).sharedContact, null);
});

test('旧学生认证接口明确下线且当前服务不再需要学生认证存储', async () => {
  const users = [{ id: 'ordinary', role: 'user', status: 'ACTIVE', profile: { nickname: '普通用户', gender: 'FEMALE', city: '澳门', interests: [], adultConfirmed: true } }];
  const store = new MemoryStore({ users });
  const service = createPinbaService({ store, clock: () => new Date(NOW) });
  const removedActions = [
    'student.verification.get',
    'student.verification.submit',
    'student.document.prepare',
    'student.document.confirm',
    'admin.studentVerification.review'
  ];
  for (const [index, action] of removedActions.entries()) {
    const result = await service.execute({ action, data: {}, requestId: `removed-student-${index}`, idempotencyKey: `removed-${index}` }, { actorId: 'ordinary' });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'NOT_FOUND');
  }
  const replay = await service.execute({
    action: 'student.verification.submit',
    data: { ignored: true },
    requestId: 'removed-student-replay',
    idempotencyKey: 'removed-1'
  }, { actorId: 'ordinary' });
  assert.equal(replay.ok, false);
  assert.equal(replay.error.code, 'NOT_FOUND');
  assert.equal(store.idempotency.size, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(store, 'studentVerifications'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(store, 'studentVerificationSecrets'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(store, 'studentDocumentUploads'), false);
});

test('移除学生门禁后仍保留成年资料与账号状态的 Fail-Closed 校验', async () => {
  const users = [
    { id: 'adult-missing', role: 'user', status: 'ACTIVE', profile: { nickname: '未确认成年', gender: 'MALE', city: '澳门', interests: [], adultConfirmed: false } },
    { id: 'disabled', role: 'user', status: 'DISABLED', profile: { nickname: '受限用户', gender: 'FEMALE', city: '澳门', interests: [], adultConfirmed: true } }
  ];
  const service = createPinbaService({ store: new MemoryStore({ users }), clock: () => new Date(NOW) });
  const createResult = await service.execute({
    action: 'activity.create',
    data: common('food', { venue: '附近餐厅', cuisine: '粤菜', budgetRange: '50以内', dietaryNotes: '' }),
    requestId: 'adult-gate-create',
    idempotencyKey: 'adult-gate-create'
  }, { actorId: 'adult-missing' });
  assert.equal(createResult.ok, false);
  assert.equal(createResult.error.code, 'PROFILE_INCOMPLETE');

  const applicationResult = await service.execute({
    action: 'application.submit',
    data: { activityId: 'missing-activity', note: '', autoJoinConsent: true },
    requestId: 'adult-gate-apply',
    idempotencyKey: 'adult-gate-apply'
  }, { actorId: 'adult-missing' });
  assert.equal(applicationResult.ok, false);
  assert.equal(applicationResult.error.code, 'PROFILE_INCOMPLETE');

  const disabledResult = await service.execute({ action: 'activity.mine', data: {}, requestId: 'disabled-mine' }, { actorId: 'disabled' });
  assert.equal(disabledResult.ok, false);
  assert.equal(disabledResult.error.code, 'ACCOUNT_DISABLED');
});

test('用户端不再注册司机页面或司机 API', () => {
  const root = path.join(__dirname, '..');
  const app = fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8');
  const activityService = fs.readFileSync(path.join(root, 'miniprogram/services/activity.js'), 'utf8');
  const userService = fs.readFileSync(path.join(root, 'miniprogram/services/user.js'), 'utf8');
  assert.doesNotMatch(app, /driver\/index/);
  assert.doesNotMatch(activityService, /driverProfile|driverMine|acceptRide|cancelRideAssignment/);
  assert.doesNotMatch(userService, /DriverApplication|DriverDocument|selectRole/);
  assert.equal(fs.existsSync(path.join(root, 'miniprogram/subpackages/profile/driver')), false);
});

test('成员空间仅允许有效成团成员主动共享或撤回联系方式', () => {
  const root = path.join(__dirname, '../miniprogram/subpackages/activity/group');
  const script = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  const template = fs.readFileSync(path.join(root, 'index.wxml'), 'utf8');
  assert.match(script, /groupSpace/);
  assert.match(script, /shareContact/);
  assert.match(script, /revokeContact/);
  assert.match(template, /主动共享我的联系方式/);
  assert.match(template, /user-select="true"/);
  assert.match(template, /退出、取消、完成、过期或下架后/);
});

test('发布草稿按活动类型白名单隔离且活动卡支持窄屏换行与历史标识', () => {
  const root = path.join(__dirname, '../miniprogram');
  const formScript = fs.readFileSync(path.join(root, 'subpackages/publish/form/index.js'), 'utf8');
  const cardTemplate = fs.readFileSync(path.join(root, 'components/activity-card/index.wxml'), 'utf8');
  const cardStyle = fs.readFileSync(path.join(root, 'components/activity-card/index.wxss'), 'utf8');
  assert.match(formScript, /TYPE_FORM_FIELDS/);
  assert.match(formScript, /cleanFormData\(type, draft && draft\.form\)/);
  assert.match(formScript, /cleanFormData\(this\.data\.type, this\.data\.form\)/);
  assert.match(cardTemplate, /历史归档/);
  assert.match(cardStyle, /\.card-head[^}]*flex-wrap:\s*wrap/);
});

test('三类发布表单共用沉浸式自定义导航、纸纹卡片和完整键盘避让', () => {
  const root = path.join(__dirname, '../miniprogram/subpackages/publish/form');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'));
  const script = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  const template = fs.readFileSync(path.join(root, 'index.wxml'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'index.wxss'), 'utf8');
  const textControls = template.match(/<(?:input|textarea)\b[^>]*>/g) || [];

  assert.equal(config.navigationStyle, 'custom');
  assert.equal(config.navigationBarTextStyle, 'white');
  assert.equal(config.backgroundColorTop, '#075AA7');
  assert.match(script, /calculateContentTopInset/);
  assert.match(script, /contentTopInset:\s*88/);
  assert.match(script, /handleBack\(\)/);
  assert.match(template, /style="padding-top: \{\{contentTopInset\}\}px;"/);
  assert.match(template, /class="form-navigation"/);
  assert.match(template, /aria-label="返回上一页"/);
  assert.doesNotMatch(template, /class="form-navigation-title"/);
  assert.match(template, /publish-paper-texture\.webp/);
  assert.doesNotMatch(template, /class="publish-hero/);
  assert.ok(textControls.length > 0);
  textControls.forEach((control) => {
    assert.match(control, /adjust-position="true"/);
    assert.match(control, /cursor-spacing="140"/);
  });
  assert.match(style, /\.form-page\s*{[\s\S]*background:\s*#075aa7/);
  assert.match(style, /\.form-paper-background\s*{[\s\S]*position:\s*fixed/);
  const backSurfaceRule = style.match(/\.form-back-surface\s*{([^}]*)\}/);
  assert.ok(backSurfaceRule);
  assert.doesNotMatch(backSurfaceRule[1], /background\s*:/);
  assert.doesNotMatch(backSurfaceRule[1], /border\s*:/);
  assert.match(style, /padding-bottom:\s*calc\(180rpx \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(style, /@media\s*\(max-width:\s*340px\)/);
});

test('三个核心页面不再出现司机、接单或固定七人拼车文案', () => {
  const root = path.join(__dirname, '../miniprogram');
  const sources = [
    'pages/discover/index.wxml',
    'pages/discover/index.js',
    'pages/publish/index.wxml',
    'pages/publish/index.js',
    'pages/user/index.wxml',
    'subpackages/publish/form/index.wxml'
  ].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  assert.doesNotMatch(sources, /司机任务|我是司机|司机认证|确认承接|接车时间|固定 7 名/);
  assert.match(sources, /拼同行/);
  assert.match(sources, /拼运动/);
  assert.match(sources, /拼饭桌/);
});

test('用户端不再注册学生认证页面、接口、门禁或校园身份文案', () => {
  const root = path.join(__dirname, '../miniprogram');
  const files = [
    'app.json',
    'pages/publish/index.js',
    'pages/publish/index.wxml',
    'pages/community/index.js',
    'pages/community/index.wxml',
    'pages/user/index.js',
    'pages/user/index.wxml',
    'components/launch-splash/index.wxml',
    'services/api.js',
    'services/user.js',
    'subpackages/activity/detail/index.js',
    'subpackages/activity/detail/index.wxml',
    'subpackages/community/compose/index.wxml',
    'subpackages/community/detail/index.wxml',
    'subpackages/profile/edit/index.wxml',
    'subpackages/publish/form/index.js'
  ];
  const sources = files.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  assert.doesNotMatch(sources, /student\.verification|student\.document|studentVerification|STUDENT_VERIFICATION|student-access|profile\/student/);
  assert.doesNotMatch(sources, /校园学生认证|学生认证|认证后解锁|校园互助用户|校园拼单|校园社区|校园互助|校园同学|校园好味道|找同路同学|分享校园讨论/);
  assert.equal(fs.existsSync(path.join(root, 'utils/student-access.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'services/student-documents.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'subpackages/profile/student')), false);
});

test('我的页面把通知失败隔离为局部降级且不阻断个人活动', () => {
  const source = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/user/index.js'), 'utf8');
  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /mineResult\.status === 'rejected'/);
  assert.match(source, /notificationResult\.status === 'fulfilled'/);
  assert.doesNotMatch(source, /studentVerified|verificationAvailable|handleStudentVerification/);
});

test('发布入口使用双列手绘网格、真实草稿条并兼容窄屏与无障碍', () => {
  const root = path.join(__dirname, '../miniprogram/pages/publish');
  const script = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  const template = fs.readFileSync(path.join(root, 'index.wxml'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'index.wxss'), 'utf8');
  assert.match(template, /class="type-grid"/);
  assert.doesNotMatch(template, /scroll-view[^>]*scroll-x/);
  assert.match(template, /class="type-card/);
  assert.match(script, /publish-cover-companion\.webp/);
  assert.match(template, /wx:if="{{draft}}"/);
  assert.match(template, /publish-draft-avatar\.webp/);
  assert.match(template, /aria-label="{{item\.ariaLabel}}"/);
  assert.match(script, /pinba_publish_draft_/);
  assert.match(script, /hasMeaningfulDraft/);
  assert.match(style, /\.paper-background\s*{[^}]*position:\s*fixed/);
  assert.match(style, /\.type-grid\s*{[\s\S]*flex-wrap:\s*wrap[\s\S]*gap:\s*20rpx/);
  assert.match(style, /\.type-card\s*{[\s\S]*calc\(\(100% - 20rpx\) \/ 2\)[\s\S]*min-height:\s*430rpx[\s\S]*aspect-ratio:\s*304 \/ 430/);
  assert.match(style, /\.type-card-description\s*{[\s\S]*white-space:\s*normal/);
  assert.match(style, /\.type-card-art\s*{[\s\S]*width:\s*100%[\s\S]*height:\s*100%/);
  assert.match(style, /\.type-card-action\s*{[\s\S]*pointer-events:\s*none/);
  assert.match(style, /@media\s*\(max-width:\s*340px\)/);
  assert.doesNotMatch(template, /搜索|推荐|type-panel|module-row/);
});

test('发布入口忽略空白草稿并只展示最近一次有效草稿', () => {
  const pagePath = require.resolve('../miniprogram/pages/publish/index');
  const previousPage = global.Page;
  global.Page = () => {};
  delete require.cache[pagePath];
  const { readLatestDraft } = require(pagePath);
  const storage = {
    pinba_publish_draft_companion: { form: { type: 'companion', title: '   ' }, savedAt: 30 },
    pinba_publish_draft_sport: { form: { type: 'sport', sportType: '羽毛球' }, savedAt: 20 },
    pinba_publish_draft_food: { form: { type: 'food', title: '周五去吃饭' }, savedAt: 40 }
  };
  try {
    assert.deepEqual(readLatestDraft({ getStorageSync: (key) => storage[key] }), {
      type: 'food',
      typeTitle: '拼饭桌',
      title: '周五去吃饭',
      savedAt: 40
    });
    assert.equal(readLatestDraft({ getStorageSync: () => ({ form: { title: '   ' } }) }), null);
  } finally {
    delete require.cache[pagePath];
    if (previousPage) global.Page = previousPage;
    else delete global.Page;
  }
});
