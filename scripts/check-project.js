'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const failures = [];

function walk(directory, predicate, output = []) {
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath, predicate, output);
    else if (predicate(fullPath)) output.push(fullPath);
  }
  return output;
}

const required = [
  'project.config.json',
  'miniprogram/app.js',
  'miniprogram/app.json',
  'miniprogram/pages/discover/index.js',
  'miniprogram/pages/publish/index.js',
  'miniprogram/pages/user/index.js',
  'cloudfunctions/api/index.js',
  'cloudfunctions/api/package.json'
];

for (const relativePath of required) {
  if (!fs.existsSync(path.join(root, relativePath))) failures.push(`缺少必要文件：${relativePath}`);
}

for (const jsonPath of walk(root, (file) => file.endsWith('.json'))) {
  try {
    JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (error) {
    failures.push(`JSON 无法解析：${path.relative(root, jsonPath)} (${error.message})`);
  }
}

for (const jsPath of walk(root, (file) => file.endsWith('.js'))) {
  const check = spawnSync(process.execPath, ['--check', jsPath], { encoding: 'utf8' });
  if (check.status !== 0) failures.push(`JavaScript 语法错误：${path.relative(root, jsPath)}\n${check.stderr.trim()}`);
}

for (const wxmlPath of walk(path.join(root, 'miniprogram'), (file) => file.endsWith('.wxml'))) {
  const content = fs.readFileSync(wxmlPath, 'utf8');
  if (/\{\{[^}]*\.(?:slice|substring|map|filter)\s*\(/.test(content)) {
    failures.push(`WXML 中包含不支持的函数调用：${path.relative(root, wxmlPath)}`);
  }
}

const directCloudCalls = walk(path.join(root, 'miniprogram'), (file) => file.endsWith('.js'))
  .filter((file) => !file.endsWith(path.join('services', 'api.js')))
  .filter((file) => fs.readFileSync(file, 'utf8').includes('wx.cloud.callFunction'));
for (const file of directCloudCalls) failures.push(`页面或组件绕过 Service 层：${path.relative(root, file)}`);

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

const summary = {
  jsonFiles: walk(root, (file) => file.endsWith('.json')).length,
  jsFiles: walk(root, (file) => file.endsWith('.js')).length,
  wxmlFiles: walk(path.join(root, 'miniprogram'), (file) => file.endsWith('.wxml')).length,
  status: 'ok'
};
console.log(JSON.stringify(summary, null, 2));
