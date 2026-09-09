'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../miniprogram');
const MAIN_BUDGET = Math.floor(1.7 * 1024 * 1024);
const PUBLISH_BUDGET = Math.floor(1.2 * 1024 * 1024);
const SUBPACKAGE_BUDGET = Math.floor(1.5 * 1024 * 1024);
const MAIN_PUBLISH_ASSETS = new Set([
  'publish-cover-benefit.png',
  'publish-cover-companion.png',
  'publish-cover-food.png',
  'publish-cover-sport.png',
  'publish-draft-avatar.png'
]);

function walk(directory, shouldEnter = () => true) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() && shouldEnter(absolutePath) ? walk(absolutePath, shouldEnter) : entry.isFile() ? [absolutePath] : [];
  });
}

function bytes(files) {
  return files.reduce((total, file) => total + fs.statSync(file).size, 0);
}

function localImageReferences(file) {
  const source = fs.readFileSync(file, 'utf8');
  return [...source.matchAll(/["']([^"']+\.(?:png|jpe?g|gif|svg))["']/gi)]
    .map((match) => match[1])
    .filter((reference) => !reference.includes('${') && !reference.includes('{{'));
}

test('主包与各分包保留可持续增长的体积余量', () => {
  const mainFiles = walk(ROOT, (directory) => directory !== path.join(ROOT, 'subpackages'));
  const mainBytes = bytes(mainFiles);
  assert.ok(mainBytes <= MAIN_BUDGET, `主包 ${(mainBytes / 1024 / 1024).toFixed(2)}MiB 超过 1.70MiB 预算`);

  const subpackageRoot = path.join(ROOT, 'subpackages');
  for (const entry of fs.readdirSync(subpackageRoot, { withFileTypes: true }).filter((item) => item.isDirectory())) {
    const packageBytes = bytes(walk(path.join(subpackageRoot, entry.name)));
    const budget = entry.name === 'publish' ? PUBLISH_BUDGET : SUBPACKAGE_BUDGET;
    assert.ok(packageBytes <= budget, `${entry.name} 分包 ${(packageBytes / 1024 / 1024).toFixed(2)}MiB 超过 ${(budget / 1024 / 1024).toFixed(2)}MiB 预算`);
  }
});

test('主包发布素材仅保留跨页面资源，表单素材完全归属发布分包', () => {
  const mainPublishDirectory = path.join(ROOT, 'assets/images/publish');
  assert.deepEqual(new Set(fs.readdirSync(mainPublishDirectory)), MAIN_PUBLISH_ASSETS);

  const formDirectory = path.join(ROOT, 'subpackages/publish/form');
  const source = walk(formDirectory)
    .filter((file) => /\.(?:js|json|wxml|wxss)$/.test(file))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
  assert.doesNotMatch(source, /\.\.\/\.\.\/\.\.\/assets\/images\/publish\//);

  const expected = [
    'pin_food_interface.jpg', 'pin_food.png', 'fapiao.png', 'hotpot.png', 'sushi.png',
    'breakfast.png', 'barbecue.png', 'burger.png', 'picnic.png', 'yuecai.jpg', 'pin_htht.jpg'
  ];
  expected.forEach((file) => assert.ok(fs.existsSync(path.join(formDirectory, 'assets/food', file)), file));
});

test('发布入口提前加载发布分包以降低首次表单图片浮现', () => {
  const appConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  const rule = appConfig.preloadRule && appConfig.preloadRule['pages/publish/index'];
  assert.ok(rule, '缺少发布入口预加载规则');
  assert.equal(rule.network, 'all');
  assert.ok(rule.packages.includes('subpackages/publish'));
});

test('源码中的静态本地图片引用全部指向现存文件', () => {
  const sourceFiles = walk(ROOT).filter((file) => /\.(?:js|json|wxml|wxss)$/.test(file));
  for (const file of sourceFiles) {
    for (const reference of localImageReferences(file)) {
      if (/^(?:https?:|cloud:|wxfile:|data:)/.test(reference)) continue;
      const target = reference.startsWith('/')
        ? path.join(ROOT, reference.slice(1))
        : path.resolve(path.dirname(file), reference);
      assert.ok(fs.existsSync(target), `${path.relative(ROOT, file)} 引用了不存在的 ${reference}`);
    }
  }
});
