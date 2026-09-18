'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../miniprogram');
const assetRoot = path.join(root, 'assets/images/empty');
const componentRoot = path.join(root, 'components/empty-state');
const TYPES = ['activity', 'joined', 'message', 'search', 'favorite', 'network'];
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function inspectPng(filename) {
  const bytes = fs.readFileSync(path.join(assetRoot, filename));
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return {
    bytes,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes[25]
  };
}

test('六张猫狗空状态素材经过透明调色板压缩并守住主包预算', () => {
  assert.deepEqual(fs.readdirSync(assetRoot).sort(), TYPES.map((type) => `${type}.png`).sort());
  let total = 0;
  TYPES.forEach((type) => {
    const image = inspectPng(`${type}.png`);
    assert.ok(image.width <= 280 && image.height <= 280, `${type} 尺寸过大`);
    assert.ok(image.width >= 220 && image.height >= 220, `${type} 清晰度不足`);
    assert.equal(image.colorType, 3, `${type} 应使用带透明索引的调色板 PNG`);
    assert.ok(image.bytes.includes(Buffer.from('tRNS')), `${type} 必须保留透明通道`);
    assert.ok(image.bytes.length <= 26 * 1024, `${type} 体积为 ${image.bytes.length} bytes`);
    total += image.bytes.length;
  });
  assert.ok(total <= 132 * 1024, `空状态素材总量为 ${total} bytes`);
});

test('公共空状态组件覆盖六类语义、尺寸档和无几何抖动动作锁', () => {
  const script = fs.readFileSync(path.join(componentRoot, 'index.js'), 'utf8');
  const template = fs.readFileSync(path.join(componentRoot, 'index.wxml'), 'utf8');
  const style = fs.readFileSync(path.join(componentRoot, 'index.wxss'), 'utf8');
  TYPES.forEach((type) => assert.match(script, new RegExp(`'empty-${type}'`)));
  assert.match(script, /buttonText:[\s\S]*actionText:/);
  assert.match(script, /if \(this\.data\.disabled \|\| this\.data\.loading\) return/);
  assert.match(script, /triggerEvent\('action', \{ type: this\.data\.type \}\)/);
  assert.match(template, /aria-hidden="\{\{imageAriaLabel \? false : true\}\}"/);
  assert.doesNotMatch(template, /\sdisabled=/);
  assert.match(template, /slot name="footer"/);
  assert.match(style, /\.pinba-empty-state__footer\s*\{[\s\S]*width:\s*100%[\s\S]*justify-content:\s*center/);
  assert.match(style, /\.pinba-empty-state--small[\s\S]*180rpx/);
  assert.match(style, /\.pinba-empty-state--large[\s\S]*300rpx/);
  assert.match(style, /@media \(max-width: 340px\), \(max-height: 620px\)/);
});

test('真实页面按业务语义接入空状态且首屏加载分支优先', () => {
  const home = read('pages/discover/index.wxml');
  const community = read('pages/community/index.wxml');
  const user = read('pages/user/index.wxml');
  const messages = read('pages/messages/index.wxml');
  const activity = read('subpackages/community/activity/index.wxml');
  const nearby = read('subpackages/activity/nearby/index.wxml');

  assert.ok(home.indexOf('wx:if="{{loading}}"') < home.indexOf('type="{{error ? \'empty-network\''));
  assert.ok(community.indexOf('wx:if="{{loading}}"') < community.indexOf("'empty-network' : (appliedKeyword ? 'empty-search'"));
  assert.match(user, /currentList === 'joined' \? 'empty-joined' : 'empty-activity'/);
  assert.match(messages, /type="empty-message"/);
  assert.match(messages, /type="empty-network"/);
  assert.match(activity, /type="empty-message"/);
  assert.match(activity, /type="empty-network"/);
  assert.match(nearby, /type="empty-activity"[\s\S]*slot="footer"/);
  assert.match(nearby, /type="empty-network"/);
  assert.match(read('subpackages/activity/nearby/index.wxss'), /\.nearby-empty-link\s*\{[^}]*margin:\s*24rpx 0 0/);
  assert.doesNotMatch(community, /community-empty-discussion/);
});

test('刷新与分页失败不把已有内容错误切换为整页网络空态', () => {
  const homeScript = read('pages/discover/index.js');
  const communityScript = read('pages/community/index.js');
  const messageScript = read('pages/messages/index.js');
  const activityScript = read('subpackages/community/activity/index.js');
  const nearbyScript = read('subpackages/activity/nearby/index.js');

  assert.match(homeScript, /hasContent \? '' : '活动列表加载失败，请重试'/);
  assert.match(communityScript, /\.\.\.\(keepContent \? \{\} : \{ posts: \[\] \}\)/);
  assert.match(messageScript, /keepContent && this\.data\.conversations\.length/);
  assert.match(activityScript, /if \(keepVisibleItems\) return void this\.setData/);
  assert.match(nearbyScript, /if \(keepContent\)[\s\S]*wx\.showToast/);
});
