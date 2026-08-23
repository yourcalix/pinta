'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const PRIVATE_CONFIG = 'project.private.config.json';
const MANUAL_EVIDENCE = 'g1-readiness.manual.json';

const manualDefinitions = [
  {
    id: 'account_members',
    name: '微信账号成员与最小权限已复核',
    blocking: true,
    remedy: '在微信后台复核管理员、开发者和体验成员，并在私有证据文件中登记证据。'
  },
  {
    id: 'service_category',
    name: '服务类目与真实功能边界一致',
    blocking: true,
    remedy: '确认拼车、商品凑单和活动搭子使用的服务类目；受限场景应先关闭入口。'
  },
  {
    id: 'privacy_guide',
    name: '隐私保护指引已声明实际剪贴板用途',
    blocking: true,
    remedy: '在微信后台完成隐私保护指引，并确认只声明当前真实使用的数据与接口。'
  },
  {
    id: 'ios_privacy_flow',
    name: 'iOS 真实 AppID 隐私链路已通过',
    blocking: true,
    remedy: '使用 iPhone 完成首次授权、拒绝、10 秒内重试、协议打开和原生复制反馈。'
  },
  {
    id: 'android_privacy_flow',
    name: 'Android 真实 AppID 隐私链路已通过',
    blocking: true,
    remedy: '使用 Android 真机完成授权、长按复制、大字号和全面屏安全区验收。'
  },
  {
    id: 'test_cloudbase_environment',
    name: '测试 CloudBase 环境已创建并明确负责人',
    blocking: true,
    remedy: '只需先创建测试环境并记录负责人；环境 ID 不得写入仓库证据。'
  },
  {
    id: 'content_security_owner',
    name: '内容安全申请入口与负责人已备案',
    blocking: false,
    remedy: '进入 G1 后尽快完成内容安全接口配置；生产环境不得静默放行。'
  },
  {
    id: 'subscription_template_submission',
    name: '订阅消息模板申请已提交',
    blocking: false,
    remedy: '模板审批结果不阻断 G1，但 G3 通知链路前必须取得可用模板。'
  },
  {
    id: 'production_cloudbase_environment',
    name: '生产 CloudBase 环境已规划或创建',
    blocking: false,
    remedy: '生产环境可延后到上线准备阶段，禁止与测试数据混用。'
  }
];

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, valid: false, value: null };
  try {
    return { exists: true, valid: true, value: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch (error) {
    return { exists: true, valid: false, value: null, error: error.message };
  }
}

function parseStaticLiteral(token) {
  if (token === 'true') return { valid: true, value: true };
  if (token === 'false') return { valid: true, value: false };
  if (/^-?\d+(?:\.\d+)?$/.test(token)) return { valid: true, value: Number(token) };
  if (/^\[\s*\]$/.test(token)) return { valid: true, value: [] };
  if (/^'(?:[^'\\]|\\.)*'$/.test(token) || /^"(?:[^"\\]|\\.)*"$/.test(token)) {
    return { valid: true, value: token.slice(1, -1) };
  }
  return { valid: false, value: null };
}

function readStaticRuntimeConfig(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, valid: false, value: null };
  const source = fs.readFileSync(filePath, 'utf8');
  const exportMatch = source.match(/^\s*(['"])use strict\1;\s*module\.exports\s*=\s*\{([\s\S]*?)\};\s*$/);
  if (!exportMatch) return { exists: true, valid: false, value: null };

  const value = {};
  const lines = exportMatch[2].split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const propertyMatch = line.match(/^([A-Za-z][A-Za-z0-9]*)\s*:\s*(.*?)(,)?$/);
    if (!propertyMatch || (index < lines.length - 1 && !propertyMatch[3])) {
      return { exists: true, valid: false, value: null };
    }
    const key = propertyMatch[1];
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      return { exists: true, valid: false, value: null };
    }
    const literal = parseStaticLiteral(propertyMatch[2].trim());
    if (!literal.valid) return { exists: true, valid: false, value: null };
    value[key] = literal.value;
  }
  return { exists: true, valid: true, value };
}

function createGitProbe(rootDir) {
  return {
    isIgnored(relativePath) {
      return spawnSync('git', ['check-ignore', '-q', '--', relativePath], { cwd: rootDir }).status === 0;
    },
    isTracked(relativePath) {
      return spawnSync('git', ['ls-files', '--error-unmatch', '--', relativePath], {
        cwd: rootDir,
        stdio: 'ignore'
      }).status === 0;
    }
  };
}

function automaticCheck(id, name, passed, evidence, remedy) {
  return {
    id,
    name,
    mode: 'AUTOMATIC',
    blocking: true,
    status: passed ? 'PASS' : 'BLOCKED',
    evidence,
    remedy: passed ? '' : remedy
  };
}

function isValidIsoDate(value) {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function evaluateManualCheck(definition, record, manualFilePresent) {
  const declaredStatus = record && typeof record.status === 'string'
    ? record.status.toUpperCase()
    : 'PENDING';
  const evidence = {
    manualFilePresent,
    recordPresent: Boolean(record),
    declaredStatus,
    checkedAtPresent: isValidIsoDate(record && record.checkedAt),
    checkedByPresent: Boolean(record && typeof record.checkedBy === 'string' && record.checkedBy.trim()),
    evidenceCount: record && Array.isArray(record.evidence)
      ? record.evidence.filter((item) => typeof item === 'string' && item.trim()).length
      : 0
  };

  let status = 'MANUAL';
  if (declaredStatus === 'FAIL' && definition.blocking) {
    status = 'BLOCKED';
  } else if (
    declaredStatus === 'PASS' &&
    evidence.checkedAtPresent &&
    evidence.checkedByPresent &&
    evidence.evidenceCount > 0
  ) {
    status = 'PASS';
  }

  return {
    id: definition.id,
    name: definition.name,
    mode: 'MANUAL',
    blocking: definition.blocking,
    status,
    evidence,
    remedy: status === 'PASS' ? '' : definition.remedy
  };
}

function evaluateReadiness(options = {}) {
  const rootDir = options.rootDir || root;
  const git = options.git || createGitProbe(rootDir);
  const generatedAt = options.now || new Date().toISOString();
  const checks = [];

  const publicConfig = readJson(path.join(rootDir, 'project.config.json'));
  const publicConfigObject = publicConfig.valid && isObject(publicConfig.value);
  const publicBaselineValid = publicConfigObject && publicConfig.value.appid === 'touristappid';
  checks.push(automaticCheck(
    'public-appid-baseline',
    '公共项目配置保持 touristappid',
    publicBaselineValid,
    { filePresent: publicConfig.exists, jsonValid: publicConfig.valid, objectValid: publicConfigObject, touristAppId: publicBaselineValid },
    '恢复公共 project.config.json 的 touristappid；真实 AppID 只能放在被忽略的私有配置中。'
  ));

  const privateIgnored = git.isIgnored(PRIVATE_CONFIG);
  const privateTracked = git.isTracked(PRIVATE_CONFIG);
  const manualIgnored = git.isIgnored(MANUAL_EVIDENCE);
  const manualTracked = git.isTracked(MANUAL_EVIDENCE);
  checks.push(automaticCheck(
    'private-files-git-isolation',
    '真实账号与人工证据文件均被 Git 隔离',
    privateIgnored && !privateTracked && manualIgnored && !manualTracked,
    { privateConfigIgnored: privateIgnored, privateConfigTracked: privateTracked, manualEvidenceIgnored: manualIgnored, manualEvidenceTracked: manualTracked },
    '把 project.private.config.json 与 g1-readiness.manual.json 加入 .gitignore，并确保二者未被 Git 跟踪。'
  ));

  const privateConfig = readJson(path.join(rootDir, PRIVATE_CONFIG));
  const privateConfigObject = privateConfig.valid && isObject(privateConfig.value);
  const privateAppId = privateConfigObject ? String(privateConfig.value.appid || '') : '';
  const privateAppIdValid = /^wx[0-9a-f]{16}$/i.test(privateAppId) && privateAppId !== 'touristappid';
  checks.push(automaticCheck(
    'private-real-appid',
    '私有配置包含格式有效的真实 AppID',
    privateConfigObject && privateAppIdValid,
    {
      filePresent: privateConfig.exists,
      jsonValid: privateConfig.valid,
      objectValid: privateConfigObject,
      appIdPresent: Boolean(privateAppId),
      appIdFormatValid: privateAppIdValid,
      source: PRIVATE_CONFIG
    },
    '复制 project.private.config.example.json 为 project.private.config.json，并仅在本地填入真实 AppID。'
  ));

  const runtimeConfigPath = path.join(rootDir, 'miniprogram/config/index.js');
  const runtimeConfigFile = readStaticRuntimeConfig(runtimeConfigPath);
  const runtimeConfig = runtimeConfigFile.value;
  const runtimeConfigValid = runtimeConfigFile.valid;
  const mockBaselineValid = runtimeConfigValid &&
    runtimeConfig.useMock === true &&
    runtimeConfig.cloudEnv === '' &&
    Array.isArray(runtimeConfig.subscribeTemplateIds) &&
    runtimeConfig.subscribeTemplateIds.length === 0;
  checks.push(automaticCheck(
    'pre-g1-runtime-baseline',
    '进入 G1 前仍保持 Mock 与空真实环境配置',
    mockBaselineValid,
    {
      configReadable: runtimeConfigValid,
      useMock: runtimeConfigValid ? runtimeConfig.useMock === true : false,
      cloudEnvEmpty: runtimeConfigValid ? runtimeConfig.cloudEnv === '' : false,
      subscribeTemplateIdsEmpty: runtimeConfigValid
        ? Array.isArray(runtimeConfig.subscribeTemplateIds) && runtimeConfig.subscribeTemplateIds.length === 0
        : false
    },
    '不要提前切换 CloudBase；恢复 useMock=true、cloudEnv="" 和空订阅模板列表。'
  ));

  const manual = readJson(path.join(rootDir, MANUAL_EVIDENCE));
  const manualObject = manual.valid && isObject(manual.value);
  const manualChecksObject = manualObject && isObject(manual.value.checks);
  if (manual.exists && (!manualObject || manual.value.schemaVersion !== 1 || !manualChecksObject)) {
    checks.push(automaticCheck(
      'manual-evidence-schema',
      '人工证据文件结构有效',
      false,
      {
        filePresent: true,
        jsonValid: manual.valid,
        objectValid: manualObject,
        schemaVersionValid: Boolean(manualObject && manual.value.schemaVersion === 1),
        checksObjectValid: manualChecksObject
      },
      '用 g1-readiness.manual.example.json 重新生成私有人工证据文件。'
    ));
  }
  const manualChecks = manualChecksObject ? manual.value.checks : {};
  for (const definition of manualDefinitions) {
    checks.push(evaluateManualCheck(definition, manualChecks[definition.id], manual.exists));
  }

  const summary = checks.reduce((result, check) => {
    result[check.status.toLowerCase()] += 1;
    if (check.mode === 'MANUAL' && check.blocking && check.status !== 'PASS') result.blockingManualRemaining += 1;
    if (!check.blocking && check.status !== 'PASS') result.advisoryRemaining += 1;
    return result;
  }, { pass: 0, manual: 0, blocked: 0, blockingManualRemaining: 0, advisoryRemaining: 0 });

  let result = 'PASS';
  let exitCode = 0;
  let nextAction = '自动门禁与阻断性人工证据均已通过，可以创建 G1 真实 CloudBase 联调任务。';
  if (summary.blocked > 0) {
    result = 'BLOCKED';
    exitCode = 1;
    nextAction = '先修复所有 BLOCKED 项；不得创建或执行 G1 切换任务。';
  } else if (summary.blockingManualRemaining > 0) {
    result = 'MANUAL';
    exitCode = 3;
    nextAction = '补全 g1-readiness.manual.json 中的阻断性人工证据后重新运行门禁。';
  }

  return {
    schemaVersion: 1,
    result,
    exitCode,
    generatedAt,
    runtime: { node: process.version },
    summary,
    checks,
    nextAction
  };
}

function main() {
  const report = evaluateReadiness();
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.exitCode;
}

if (require.main === module) main();

module.exports = {
  evaluateReadiness,
  manualDefinitions,
  readStaticRuntimeConfig
};
