'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function pageFiles(extension) {
  const result = [];
  function walk(directory, relative = '') {
    fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      const nextRelative = path.join(relative, entry.name);
      const nextPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(nextPath, nextRelative);
      else if (entry.name === `index.${extension}` && !nextRelative.split(path.sep).includes('components')) {
        result.push(nextRelative.replaceAll(path.sep, '/'));
      }
    });
  }
  walk(path.join(root, 'pages'), 'pages');
  walk(path.join(root, 'subpackages'), 'subpackages');
  return result.sort();
}

test('普通页面不再挂载旧深蓝纸纹背景，搭子星球保留独立暗夜主题', () => {
  const templates = pageFiles('wxml');
  assert.equal(templates.length, 25);
  templates.forEach((relativePath) => {
    const template = read(relativePath);
    assert.doesNotMatch(template, /shared-paper-bg\.jpg/, relativePath);
    assert.doesNotMatch(template, /global-page-background(?:-tint)?/, relativePath);
    assert.doesNotMatch(template, /global-background-host/, relativePath);
  });

  const planetStyle = read('subpackages/community/companion/index.wxss');
  assert.match(planetStyle, /#0D0C1B/i);
  const profileTemplate = read('pages/user/index.wxml');
  assert.match(profileTemplate, /class="profile-atmosphere"/);
  assert.match(profileTemplate, /profile-atmosphere-image/);
});

test('全局托底改为暖米白且旧共享背景资产被移除', () => {
  const style = read('app.wxss');
  assert.match(style, /page\s*{[\s\S]*background:\s*#f9f7f2/i);
  assert.doesNotMatch(style, /#075aa7/i);
  assert.doesNotMatch(style, /\.global-page-background/);
  assert.equal(fs.existsSync(path.join(root, 'assets/images/shared/shared-paper-bg.jpg')), false);
});

test('原生窗口统一使用暖米白占位，暗夜星球显式例外', () => {
  const app = JSON.parse(read('app.json'));
  assert.equal(app.window.navigationBarBackgroundColor, '#F9F7F2');
  assert.equal(app.window.navigationBarTextStyle, 'black');
  assert.equal(app.window.backgroundColor, '#F9F7F2');
  assert.equal(app.window.backgroundTextStyle, 'dark');

  const exceptions = {
    'subpackages/community/companion/index.json': ['#0D0C1B', 'light'],
    'subpackages/activity/detail/index.json': ['#FFFFFF', 'dark'],
    'subpackages/profile/edit/index.json': ['#F6F7F9', 'dark'],
    'subpackages/map/index/index.json': ['#F6F2EA', 'dark']
  };
  pageFiles('json').forEach((relativePath) => {
    const config = JSON.parse(read(relativePath));
    const expected = exceptions[relativePath] || ['#F9F7F2', 'dark'];
    assert.equal(config.backgroundColor, expected[0], relativePath);
    assert.equal(config.backgroundTextStyle, expected[1], relativePath);
    if (config.navigationStyle !== 'custom') {
      assert.equal(config.navigationBarBackgroundColor, expected[0], relativePath);
      assert.equal(config.navigationBarTextStyle, expected[1] === 'light' ? 'white' : 'black', relativePath);
    }
  });
});
