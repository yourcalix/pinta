'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const VALID_APP_ID = 'wx1234567890abcdef';

const blockingManualIds = [
  'account_members',
  'service_category',
  'privacy_guide',
  'ios_privacy_flow',
  'android_privacy_flow',
  'test_cloudbase_environment'
];

function completedEvidence() {
  return {
    schemaVersion: 1,
    checks: Object.fromEntries([
      ...blockingManualIds.map((id) => [id, {
        status: 'PASS',
        checkedAt: '2026-08-23T08:00:00.000Z',
        checkedBy: 'local-operator',
        evidence: [`local-evidence/${id}.md`],
        notes: ''
      }]),
      ['content_security_owner', { status: 'PENDING', checkedAt: null, checkedBy: '', evidence: [], notes: '' }],
      ['subscription_template_submission', { status: 'PENDING', checkedAt: null, checkedBy: '', evidence: [], notes: '' }],
      ['production_cloudbase_environment', { status: 'PENDING', checkedAt: null, checkedBy: '', evidence: [], notes: '' }]
    ])
  };
}

function makeFixture(options = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinba-g1-gate-'));
  fs.mkdirSync(path.join(rootDir, 'miniprogram/config'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'project.config.json'), JSON.stringify({ appid: 'touristappid' }));
  fs.writeFileSync(
    path.join(rootDir, 'miniprogram/config/index.js'),
    [
      "'use strict';",
      '',
      'module.exports = {',
      `  useMock: ${options.useMock === false ? 'false' : 'true'},`,
      "  cloudEnv: '',",
      "  apiFunction: 'api',",
      '  requestTimeoutMs: 8000,',
      `  subscribeTemplateIds: ${options.templateIds ? "['template']" : '[]'},`,
      "  demoCity: '上海'",
      '};',
      ''
    ].join('\n')
  );
  fs.writeFileSync(path.join(rootDir, '.gitignore'), 'project.private.config.json\ng1-readiness.manual.json\n');

  if (options.privateConfig !== false) {
    fs.writeFileSync(
      path.join(rootDir, 'project.private.config.json'),
      JSON.stringify({ appid: options.privateAppId || VALID_APP_ID })
    );
  }

  if (options.manual !== false) {
    fs.writeFileSync(
      path.join(rootDir, 'g1-readiness.manual.json'),
      JSON.stringify(options.manual || completedEvidence())
    );
  }
  return rootDir;
}

function fakeGit() {
  return {
    isIgnored: () => true,
    isTracked: () => false
  };
}

test('全部阻断项具备证据时门禁 PASS 且报告不泄露 AppID', () => {
  const { evaluateReadiness } = require('../scripts/g1-readiness-gate');
  const rootDir = makeFixture();
  const report = evaluateReadiness({ rootDir, git: fakeGit(), now: '2026-08-23T08:30:00.000Z' });

  assert.equal(report.result, 'PASS');
  assert.equal(report.exitCode, 0);
  assert.doesNotMatch(JSON.stringify(report), /wx[0-9a-f]{16}/i);
  assert.equal(report.checks.find((check) => check.id === 'private-real-appid').status, 'PASS');
  assert.equal(report.checks.find((check) => check.id === 'subscription_template_submission').status, 'MANUAL');
  assert.equal(report.summary.blockingManualRemaining, 0);
  assert.equal(report.summary.advisoryRemaining, 3);
});

test('缺少人工证据文件时返回 MANUAL 而不是伪造通过', () => {
  const { evaluateReadiness } = require('../scripts/g1-readiness-gate');
  const rootDir = makeFixture({ manual: false });
  const report = evaluateReadiness({ rootDir, git: fakeGit() });

  assert.equal(report.result, 'MANUAL');
  assert.equal(report.exitCode, 3);
  assert.match(report.nextAction, /人工证据/);
});

test('缺少真实 AppID 私有覆盖时返回 BLOCKED', () => {
  const { evaluateReadiness } = require('../scripts/g1-readiness-gate');
  const rootDir = makeFixture({ privateConfig: false });
  const report = evaluateReadiness({ rootDir, git: fakeGit() });

  assert.equal(report.result, 'BLOCKED');
  assert.equal(report.exitCode, 1);
  assert.equal(report.checks.find((check) => check.id === 'private-real-appid').status, 'BLOCKED');
});

test('阻断人工项即使写 PASS 但缺少证据元数据仍返回 MANUAL', () => {
  const { evaluateReadiness } = require('../scripts/g1-readiness-gate');
  const manual = completedEvidence();
  manual.checks.privacy_guide.evidence = [];
  const rootDir = makeFixture({ manual });
  const report = evaluateReadiness({ rootDir, git: fakeGit() });

  assert.equal(report.result, 'MANUAL');
  assert.equal(report.checks.find((check) => check.id === 'privacy_guide').status, 'MANUAL');
});

test('阻断人工项明确 FAIL 时返回 BLOCKED', () => {
  const { evaluateReadiness } = require('../scripts/g1-readiness-gate');
  const manual = completedEvidence();
  manual.checks.android_privacy_flow.status = 'FAIL';
  const rootDir = makeFixture({ manual });
  const report = evaluateReadiness({ rootDir, git: fakeGit() });

  assert.equal(report.result, 'BLOCKED');
  assert.equal(report.checks.find((check) => check.id === 'android_privacy_flow').status, 'BLOCKED');
});

test('配置文件为合法 JSON 但不是对象时安全返回 BLOCKED', () => {
  const { evaluateReadiness } = require('../scripts/g1-readiness-gate');
  const rootDir = makeFixture();
  fs.writeFileSync(path.join(rootDir, 'project.private.config.json'), 'null');
  fs.writeFileSync(path.join(rootDir, 'g1-readiness.manual.json'), 'null');

  let report;
  assert.doesNotThrow(() => {
    report = evaluateReadiness({ rootDir, git: fakeGit() });
  });
  assert.equal(report.result, 'BLOCKED');
});

test('公共 AppID 被替换或私有 AppID 格式错误时返回 BLOCKED', () => {
  const { evaluateReadiness } = require('../scripts/g1-readiness-gate');
  const rootDir = makeFixture({ privateAppId: 'wx-invalid' });
  fs.writeFileSync(path.join(rootDir, 'project.config.json'), JSON.stringify({ appid: VALID_APP_ID }));
  const report = evaluateReadiness({ rootDir, git: fakeGit() });

  assert.equal(report.result, 'BLOCKED');
  assert.equal(report.checks.find((check) => check.id === 'public-appid-baseline').status, 'BLOCKED');
  assert.equal(report.checks.find((check) => check.id === 'private-real-appid').status, 'BLOCKED');
});

test('私有配置或人工证据被 Git 跟踪时返回 BLOCKED', () => {
  const { evaluateReadiness } = require('../scripts/g1-readiness-gate');
  const rootDir = makeFixture();
  const report = evaluateReadiness({
    rootDir,
    git: { isIgnored: () => true, isTracked: () => true }
  });

  assert.equal(report.result, 'BLOCKED');
  assert.equal(report.checks.find((check) => check.id === 'private-files-git-isolation').status, 'BLOCKED');
});

test('提前关闭 Mock 或写入订阅模板时返回 BLOCKED', () => {
  const { evaluateReadiness } = require('../scripts/g1-readiness-gate');
  const rootDir = makeFixture({ useMock: false, templateIds: true });
  const report = evaluateReadiness({ rootDir, git: fakeGit() });

  assert.equal(report.result, 'BLOCKED');
  assert.equal(report.checks.find((check) => check.id === 'pre-g1-runtime-baseline').status, 'BLOCKED');
});

test('门禁不会执行被篡改的运行配置文件', () => {
  const { evaluateReadiness } = require('../scripts/g1-readiness-gate');
  const rootDir = makeFixture();
  const marker = path.join(rootDir, 'side-effect.txt');
  fs.writeFileSync(
    path.join(rootDir, 'miniprogram/config/index.js'),
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed'); module.exports = { useMock: true, cloudEnv: '', subscribeTemplateIds: [] };\n`
  );

  const report = evaluateReadiness({ rootDir, git: fakeGit() });
  assert.equal(report.result, 'BLOCKED');
  assert.equal(fs.existsSync(marker), false);
});

test('人工证据模板与门禁定义保持一致', () => {
  const { manualDefinitions } = require('../scripts/g1-readiness-gate');
  const template = JSON.parse(fs.readFileSync(path.join(__dirname, '../g1-readiness.manual.example.json'), 'utf8'));
  assert.deepEqual(Object.keys(template.checks).sort(), manualDefinitions.map((item) => item.id).sort());
});
