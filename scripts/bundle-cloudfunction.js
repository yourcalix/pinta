'use strict';

const fs = require('node:fs');
const path = require('node:path');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

const GENERATED_FILENAMES = new Set(['index.js', 'package.json', 'config.json']);

function collectModuleFiles(root, current = root) {
  return fs.readdirSync(current, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') return [];
        return collectModuleFiles(root, absolute);
      }
      if (!entry.isFile() || !/\.(?:js|json)$/.test(entry.name)) return [];
      if (current === root && (entry.name === 'package.json' || entry.name === 'config.json')) return [];
      return [path.relative(root, absolute).split(path.sep).join('/')];
    })
    .sort();
}

function buildBundle(sourceDirectory) {
  const moduleFiles = collectModuleFiles(sourceDirectory);
  if (!moduleFiles.includes('index.js')) throw new Error('云函数缺少 index.js');
  const modules = moduleFiles.map((id) => {
    const source = fs.readFileSync(path.join(sourceDirectory, ...id.split('/')), 'utf8');
    if (id.endsWith('.json')) {
      const value = JSON.parse(source);
      return `${JSON.stringify(id)}: function(require, module, exports) {\nmodule.exports = ${JSON.stringify(value)};\n}`;
    }
    return `${JSON.stringify(id)}: function(require, module, exports) {\n${source}\n}`;
  }).join(',\n');

  return `'use strict';

const __modules = {
${modules}
};
const __cache = Object.create(null);

function __resolve(fromId, request) {
  if (!request.startsWith('.')) return request;
  const parts = fromId.split('/');
  parts.pop();
  for (const part of request.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  const base = parts.join('/');
  const candidates = /\\.[^/]+$/.test(base)
    ? [base]
    : [base, base + '.js', base + '.json', base + '/index.js', base + '/index.json'];
  const resolved = candidates.find((candidate) => Object.prototype.hasOwnProperty.call(__modules, candidate));
  if (!resolved) throw new Error("Cannot find bundled module '" + request + "' from '" + fromId + "'");
  return resolved;
}

function __load(id) {
  if (__cache[id]) return __cache[id].exports;
  const factory = __modules[id];
  if (!factory) throw new Error("Bundled module is unavailable: " + id);
  const module = { exports: {} };
  __cache[id] = module;
  const localRequire = (request) => {
    const resolved = __resolve(id, request);
    return request.startsWith('.') ? __load(resolved) : require(request);
  };
  factory(localRequire, module, module.exports);
  return module.exports;
}

module.exports = __load('index.js');
`;
}

function prepareOutputDirectory(outputDirectory) {
  const parentDirectory = path.dirname(outputDirectory);
  fs.mkdirSync(parentDirectory, { recursive: true });
  if (!fs.existsSync(outputDirectory)) return;
  if (!fs.statSync(outputDirectory).isDirectory()) throw new Error('输出路径已存在且不是目录');
  const entries = fs.readdirSync(outputDirectory, { withFileTypes: true });
  const unsafe = entries.find((entry) => !GENERATED_FILENAMES.has(entry.name) || (!entry.isFile() && !entry.isSymbolicLink()));
  if (unsafe) throw new Error(`输出目录包含非生成文件，拒绝覆盖: ${unsafe.name}`);
  for (const entry of entries) fs.unlinkSync(path.join(outputDirectory, entry.name));
  fs.rmdirSync(outputDirectory);
}

function main() {
  const sourceDirectory = path.resolve(process.argv[2] || '');
  const outputDirectory = path.resolve(process.argv[3] || '');
  if (!process.argv[2] || !process.argv[3]) return fail('用法: node scripts/bundle-cloudfunction.js <source> <output>');
  if (!fs.existsSync(sourceDirectory) || !fs.statSync(sourceDirectory).isDirectory()) return fail('云函数源码目录不存在');
  if (sourceDirectory === outputDirectory || outputDirectory.startsWith(`${sourceDirectory}${path.sep}`)) return fail('输出目录不能位于源码目录内');
  try {
    prepareOutputDirectory(outputDirectory);
    fs.mkdirSync(outputDirectory, { recursive: false });
    fs.writeFileSync(path.join(outputDirectory, 'index.js'), buildBundle(sourceDirectory));
    for (const filename of ['package.json', 'config.json']) {
      const source = path.join(sourceDirectory, filename);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(outputDirectory, filename));
    }
  } catch (error) {
    fail(error && error.message ? error.message : String(error));
  }
}

if (require.main === module) main();

module.exports = {
  buildBundle,
  collectJavaScriptFiles: collectModuleFiles,
  collectModuleFiles,
  prepareOutputDirectory
};
