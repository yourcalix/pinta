'use strict';

const { formatDateTime } = require('./date');

const GROUP_WINDOW_MS = 3 * 60 * 1000;
const AVATAR_TONES = Object.freeze(['blue', 'purple', 'orange', 'green', 'teal']);

function timestamp(value) {
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : NaN;
}

function safeAnchorId(id, index) {
  const normalized = String(id || `item-${index}`).replace(/[^A-Za-z0-9_-]/g, '-');
  return `message-${normalized}`;
}

function decorateMessageList(items = [], peerNickname = '拼吧用户') {
  const nickname = String(peerNickname || '拼吧用户').trim() || '拼吧用户';
  return items.map((item, index) => {
    const previous = index > 0 ? items[index - 1] : null;
    const currentTime = timestamp(item.createdAt);
    const previousTime = previous ? timestamp(previous.createdAt) : NaN;
    const sameSender = Boolean(previous) && Boolean(previous.isMine) === Boolean(item.isMine);
    const gap = currentTime - previousTime;
    const compact = sameSender && Number.isFinite(gap) && gap >= 0 && gap < GROUP_WINDOW_MS;
    const displayTime = formatDateTime(item.createdAt);
    const sender = item.isMine ? '我' : nickname;
    return {
      ...item,
      anchorId: safeAnchorId(item.id, index),
      displayTime,
      showTime: !compact,
      showPeerAvatar: !item.isMine && !compact,
      compact,
      accessibilityLabel: `${sender}发送的消息：${String(item.text || '')}，发送时间${displayTime}`
    };
  });
}

function getPeerIdentity(nickname) {
  const normalized = String(nickname || '拼吧用户').trim() || '拼吧用户';
  const initial = Array.from(normalized)[0] || '拼';
  return {
    nickname: normalized,
    initial,
    tone: AVATAR_TONES[(initial.codePointAt(0) || 0) % AVATAR_TONES.length]
  };
}

function mergeMessages(existing = [], incoming = []) {
  const byId = new Map();
  [...existing, ...incoming].forEach((item) => {
    if (item && typeof item.id === 'string' && item.id) byId.set(item.id, item);
  });
  return [...byId.values()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))
    || String(a.id).localeCompare(String(b.id)));
}

module.exports = {
  GROUP_WINDOW_MS,
  decorateMessageList,
  getPeerIdentity,
  mergeMessages
};
