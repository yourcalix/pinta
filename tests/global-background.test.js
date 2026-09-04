'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function pageTemplates() {
  return [
    ...fs.readdirSync(path.join(root, 'pages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `pages/${entry.name}/index.wxml`),
    ...fs.readdirSync(path.join(root, 'subpackages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((subpackage) => fs.readdirSync(path.join(root, 'subpackages', subpackage.name), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `subpackages/${subpackage.name}/${entry.name}/index.wxml`))
  ].sort();
}

test('除参考式白底活动详情外，所有页面共用唯一拼图纸纹背景', () => {
  const templates = pageTemplates();
  assert.equal(templates.length, 15);
  templates.filter((relativePath) => relativePath !== 'subpackages/activity/detail/index.wxml').forEach((relativePath) => {
    const template = read(relativePath);
    assert.equal((template.match(/shared-paper-bg\.webp/g) || []).length, 1, relativePath);
    assert.match(template, /src="\/assets\/images\/shared\/shared-paper-bg\.webp"/, relativePath);
    assert.match(template, /class="global-page-background"[^>]*mode="aspectFill"[^>]*aria-hidden="true"/, relativePath);
    assert.match(template, /class="global-page-background-tint"[^>]*aria-hidden="true"/, relativePath);
    assert.match(template, /global-background-host/, relativePath);
    assert.doesNotMatch(template, /publish-paper-texture\.webp/, relativePath);
  });
});

test('共享背景资产和全局样式满足主包、固定视口与对比度保护要求', () => {
  const assetPath = path.join(root, 'assets/images/shared/shared-paper-bg.webp');
  const asset = fs.readFileSync(assetPath);
  const style = read('app.wxss');
  assert.equal(asset.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(asset.subarray(8, 12).toString('ascii'), 'WEBP');
  assert.ok(asset.length <= 200 * 1024, `背景图超过 200KB：${asset.length}`);
  assert.match(style, /\.global-page-background,[\s\S]*position:\s*fixed[\s\S]*width:\s*100vw[\s\S]*height:\s*100vh/);
  assert.match(style, /\.global-page-background\s*{[\s\S]*opacity:\s*0\.88/);
  assert.match(style, /\.global-page-background-tint\s*{[\s\S]*rgba\(7, 45, 90, 0\.45\)/);
  assert.match(style, /\.global-page-background-tint\s*{[\s\S]*transform:\s*translateZ\(0\)/);
  assert.match(style, /pointer-events:\s*none/);
});

test('全局与二级页面原生窗口使用深蓝占位避免图片解码前白闪', () => {
  const app = JSON.parse(read('app.json'));
  assert.equal(app.window.navigationBarBackgroundColor, '#075AA7');
  assert.equal(app.window.navigationBarTextStyle, 'white');
  assert.equal(app.window.backgroundColor, '#075AA7');
  assert.equal(app.window.backgroundTextStyle, 'light');

  const configs = pageTemplates().map((template) => template.replace(/\.wxml$/, '.json'));
  configs.forEach((relativePath) => {
    const config = JSON.parse(read(relativePath));
    if (relativePath === 'subpackages/activity/detail/index.json') {
      assert.equal(config.backgroundColor, '#FFFFFF', relativePath);
      assert.equal(config.backgroundTextStyle, 'dark', relativePath);
      return;
    }
    assert.equal(config.backgroundColor, '#075AA7', relativePath);
    assert.equal(config.backgroundTextStyle, 'light', relativePath);
    if (config.navigationStyle !== 'custom') {
      assert.equal(config.navigationBarBackgroundColor, '#075AA7', relativePath);
      assert.equal(config.navigationBarTextStyle, 'white', relativePath);
    }
  });
});
