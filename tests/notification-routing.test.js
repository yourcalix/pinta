'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const userService = require('../miniprogram/services/user');
const {
  resolveNotificationTarget,
  buildNotificationPage
} = require('../cloudfunctions/api/lib/notification-target');
const {
  decorateNotification,
  resolveNotificationPath
} = require('../miniprogram/services/notification-router');

const CASES = [
  ['NEW_APPLICATION', 'MANAGE', 'subpackages/activity/manage/index'],
  ['GROUP_FORMED', 'GROUP', 'subpackages/activity/group/index'],
  ['APPLICATION_APPROVED', 'DETAIL', 'subpackages/activity/detail/index'],
  ['APPLICATION_CLOSED', 'DETAIL', 'subpackages/activity/detail/index'],
  ['APPLICATION_REJECTED', 'DETAIL', 'subpackages/activity/detail/index'],
  ['ACTIVITY_CANCELLED', 'DETAIL', 'subpackages/activity/detail/index'],
  ['ACTIVITY_TAKEDOWN', 'DETAIL', 'subpackages/activity/detail/index'],
  ['FUTURE_UNKNOWN', 'DETAIL', 'subpackages/activity/detail/index']
];

test('后端通知类型只解析为三种语义目标且生成服务通知安全 page', () => {
  CASES.forEach(([type, target, page]) => {
    assert.equal(resolveNotificationTarget(type), target);
    assert.equal(
      buildNotificationPage(type, 'activity/a?x=1'),
      `${page}?id=activity%2Fa%3Fx%3D1`
    );
  });
  assert.equal(buildNotificationPage('GROUP_FORMED', ''), 'pages/discover/index');
});

test('客户端只接受目标枚举，任意 target 降级详情且缺失 ID 返回发现', () => {
  CASES.forEach(([, target, page]) => {
    assert.equal(
      resolveNotificationPath({ target, activityId: 'activity/a?x=1' }),
      `/${page}?id=activity%2Fa%3Fx%3D1`
    );
  });
  assert.equal(
    resolveNotificationPath({ target: 'https://evil.example/path', activityId: 'a_ride' }),
    '/subpackages/activity/detail/index?id=a_ride'
  );
  assert.equal(resolveNotificationPath({ target: 'GROUP', activityId: '' }), '/pages/discover/index');
  assert.equal(resolveNotificationPath(null), '/pages/discover/index');
});

test('通知展示只补充受控动作标签且不会把敏感字段写入路由', () => {
  const item = decorateNotification({
    id: 'n1',
    type: 'GROUP_FORMED',
    target: 'GROUP',
    activityId: 'a_buddy',
    title: '活动已成团',
    contactInfo: '不得进入路由',
    userId: 'internal-user'
  });
  assert.equal(item.actionLabel, '进入成团');
  const path = resolveNotificationPath(item);
  assert.equal(path, '/subpackages/activity/group/index?id=a_buddy');
  assert.equal(path.includes('contactInfo'), false);
  assert.equal(path.includes('internal-user'), false);
});

function loadUserPage() {
  let definition;
  const navigations = [];
  const tabSwitches = [];
  global.Page = (value) => { definition = value; };
  global.wx = {
    navigateTo: (options) => { navigations.push(options); },
    switchTab: (options) => { tabSwitches.push(options); },
    showModal() {}
  };
  const pagePath = require.resolve('../miniprogram/pages/user/index');
  delete require.cache[pagePath];
  require(pagePath);
  return {
    pagePath,
    navigations,
    tabSwitches,
    page: {
      ...definition,
      data: { ...definition.data },
      setData(value) { Object.assign(this.data, value); }
    }
  };
}

function unloadUserPage(pagePath) {
  delete require.cache[pagePath];
  delete global.Page;
  delete global.wx;
}

test('站内通知按目标导航，普通已读失败继续而统一处理错误停止', async () => {
  const originalRead = userService.readNotification;
  const first = loadUserPage();
  try {
    userService.readNotification = async () => {
      throw new Error('temporary read failure');
    };
    await first.page.handleTaskTap({
      currentTarget: {
        dataset: { task: { id: 'n1', target: 'MANAGE', activityId: 'a_ride' } }
      }
    });
    assert.equal(first.navigations[0].url, '/subpackages/activity/manage/index?id=a_ride');
  } finally {
    unloadUserPage(first.pagePath);
  }

  const second = loadUserPage();
  try {
    userService.readNotification = async () => {
      const error = new Error('账号已被统一处理');
      error.handled = true;
      throw error;
    };
    await second.page.handleTaskTap({
      currentTarget: {
        dataset: { task: { id: 'n2', target: 'GROUP', activityId: 'a_buddy' } }
      }
    });
    assert.equal(second.navigations.length, 0);
    assert.equal(second.tabSwitches.length, 0);
  } finally {
    userService.readNotification = originalRead;
    unloadUserPage(second.pagePath);
  }
});
