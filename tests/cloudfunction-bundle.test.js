'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');

test('云函数 staging bundle 为平铺单文件且保持云端依赖声明', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pinba-cloud-bundle-'));
  const output = path.join(temporaryRoot, 'api');
  try {
    execFileSync(process.execPath, [
      path.join(root, 'scripts/bundle-cloudfunction.js'),
      path.join(root, 'cloudfunctions/api'),
      output
    ]);
    assert.deepEqual(fs.readdirSync(output).sort(), ['config.json', 'index.js', 'package.json']);
    const bundle = fs.readFileSync(path.join(output, 'index.js'), 'utf8');
    assert.match(bundle, /"lib\/service\.js": function/);
    assert.match(bundle, /module\.exports = __load\('index\.js'\)/);
    assert.match(bundle, /student\.verification\.get/);
    execFileSync(process.execPath, ['--check', path.join(output, 'index.js')]);
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'package.json'), 'utf8'));
    assert.equal(typeof manifest.dependencies['wx-server-sdk'], 'string');

    execFileSync(process.execPath, [
      path.join(root, 'scripts/bundle-cloudfunction.js'),
      path.join(root, 'cloudfunctions/api'),
      output
    ]);
    assert.deepEqual(fs.readdirSync(output).sort(), ['config.json', 'index.js', 'package.json']);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('bundle 执行真实模块图并支持 JSON、目录 index、循环引用与外部依赖', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pinba-cloud-fixture-'));
  const source = path.join(temporaryRoot, 'source');
  const output = path.join(temporaryRoot, 'output');
  try {
    fs.mkdirSync(path.join(source, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(source, 'index.js'), [
      "const feature = require('./lib');",
      "const data = require('./data.json');",
      "const path = require('node:path');",
      "module.exports = { value: feature.value + data.suffix, separator: path.sep };"
    ].join('\n'));
    fs.writeFileSync(path.join(source, 'lib/index.js'), [
      "exports.value = 'A';",
      "const cycle = require('./cycle');",
      "exports.value += cycle.value;"
    ].join('\n'));
    fs.writeFileSync(path.join(source, 'lib/cycle.js'), [
      "const parent = require('./index');",
      "exports.value = parent.value === 'A' ? 'B' : 'X';"
    ].join('\n'));
    fs.writeFileSync(path.join(source, 'data.json'), JSON.stringify({ suffix: 'C' }));

    execFileSync(process.execPath, [path.join(root, 'scripts/bundle-cloudfunction.js'), source, output]);
    const bundled = require(path.join(output, 'index.js'));
    assert.deepEqual(bundled, { value: 'ABC', separator: path.sep });
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('bundle 对缺失本地模块和包含非生成文件的输出目录 fail-closed', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pinba-cloud-fail-closed-'));
  const source = path.join(temporaryRoot, 'source');
  const output = path.join(temporaryRoot, 'output');
  try {
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'index.js'), "module.exports = require('./missing');\n");
    execFileSync(process.execPath, [path.join(root, 'scripts/bundle-cloudfunction.js'), source, output]);
    assert.throws(
      () => require(path.join(output, 'index.js')),
      /Cannot find bundled module '\.\/missing' from 'index\.js'/
    );

    fs.writeFileSync(path.join(output, 'keep.txt'), 'user-owned');
    assert.throws(
      () => execFileSync(process.execPath, [path.join(root, 'scripts/bundle-cloudfunction.js'), source, output]),
      /输出目录包含非生成文件/
    );
    assert.equal(fs.readFileSync(path.join(output, 'keep.txt'), 'utf8'), 'user-owned');
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
