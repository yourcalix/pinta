'use strict';

module.exports = {
  useMock: false,
  cloudEnv: 'your-cloudbase-environment-id',
  apiFunction: 'api',
  amapMiniProgramKey: 'your-amap-mini-program-key',
  // 仅在 useMock === true 时生效，例如 MEAL_MENU_READY；生产环境保持空字符串。
  progressCardDebugStage: ''
};
