'use strict';

const presenceService = require('../../../services/companion-presence');
const userService = require('../../../services/user');
const ephemeralProfileNavigation = require('../../../services/ephemeral-profile-navigation');
const { calculateContentTopInset } = require('../../../utils/navigation-layout');
const { resolveCanvasTap, selectHitNode } = require('./hit-test');

const MAX_RENDERED_USERS = 50;
const MAX_VISIBLE_LABELS = 18;
const HEARTBEAT_INTERVAL_MS = 30_000;
const SNAPSHOT_INTERVAL_MS = 20_000;
const REVOLUTION_MS = 48_000;
const COLORS = ['#b9f4ef', '#f3d0d1', '#91dfdc', '#d9c7d7', '#c8eee9'];

function actionCopy(joined, onlineTotal) {
  return joined
    ? '退出搭子星球并隐身'
    : onlineTotal > 0 ? '加入搭子星球，昵称将短暂公开' : '成为第一个在线搭子，昵称将短暂公开';
}

function seededUnit(seed, salt) {
  let value = (Number(seed) ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  return (value >>> 0) / 4294967296;
}

function buildSphereNodes(users) {
  const safeUsers = (users || []).slice(0, MAX_RENDERED_USERS);
  const total = Math.max(1, safeUsers.length);
  const golden = Math.PI * (3 - Math.sqrt(5));
  return safeUsers.map((user, index) => {
    const y = 1 - 2 * ((index + .5) / total);
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = index * golden + seededUnit(user.layoutSeed, 1) * Math.PI * 2;
    return {
      ...user,
      x: Math.cos(theta) * radial,
      y,
      z: Math.sin(theta) * radial,
      color: COLORS[(Number(user.layoutSeed) >>> 0) % COLORS.length],
      labelSide: seededUnit(user.layoutSeed, 2) > .5 ? 1 : -1
    };
  });
}

Page({
  data: {
    contentTopInset: 88,
    status: 'loading',
    onlineTotal: 0,
    joined: false,
    joining: false,
    users: [],
    accessibilityLabel: '寻找搭子星球，正在连接真实在线状态',
    actionAriaLabel: '加入搭子星球'
  },

  onLoad() {
    this._disposed = false;
    this._visible = true;
    this._hasShown = false;
    this._loadSeq = 0;
    this._hitNodes = [];
    this._navigating = false;
    this.setData({ contentTopInset: calculateContentTopInset(typeof wx === 'undefined' ? null : wx) });
    return this.loadSnapshot(true);
  },

  onReady() { this.initCanvas(); },

  onShow() {
    this._visible = true;
    this._navigating = false;
    this.refreshCanvasRect();
    if (this._hasShown) this.loadSnapshot(false);
    this._hasShown = true;
    this.startAnimation();
    this.startSnapshotTimer();
  },

  onHide() {
    this._visible = false;
    this.stopRuntime(true);
  },

  onUnload() {
    this._disposed = true;
    this._visible = false;
    this._loadSeq += 1;
    if (this._navigationTimer) clearTimeout(this._navigationTimer);
    this.stopRuntime(true);
  },

  async loadSnapshot(initial = false) {
    const seq = ++this._loadSeq;
    if (initial) this.setData({ status: 'loading' });
    try {
      const snapshot = await presenceService.snapshot();
      if (this._disposed || seq !== this._loadSeq) return;
      this.applySnapshot(snapshot, this.data.joined);
    } catch (error) {
      if (this._disposed || seq !== this._loadSeq) return;
      this.setData({ status: 'error', accessibilityLabel: '寻找搭子星球暂时失联，请重新连接' });
    }
  },

  applySnapshot(snapshot, joined) {
    const users = Array.isArray(snapshot && snapshot.users) ? snapshot.users.slice(0, MAX_RENDERED_USERS) : [];
    const onlineTotal = Math.max(0, Number(snapshot && snapshot.onlineTotal) || 0);
    const isJoined = Boolean(joined && users.some((item) => item.viewerIsSelf));
    this._nodes = buildSphereNodes(users);
    this._hitNodes = [];
    this.setData({
      status: 'ready',
      onlineTotal,
      users,
      joined: isJoined,
      joining: false,
      actionAriaLabel: actionCopy(isJoined, onlineTotal),
      accessibilityLabel: `寻找搭子星球，当前共有${onlineTotal}人正在找搭子，${isJoined ? '你已加入星球' : '点击下方按钮可加入星球'}`
    });
    this.startAnimation();
  },

  async handleTogglePresence() {
    if (this.data.joining) return;
    if (this.data.joined) return this.leavePresence();
    const agreed = await this.confirmJoinDisclosure();
    if (!agreed || this._disposed) return;
    this.setData({ joining: true });
    try {
      const user = await userService.login();
      if (!user.profileComplete) {
        this.setData({ joining: false });
        wx.navigateTo({ url: `/subpackages/profile/edit/index?next=${encodeURIComponent('/subpackages/community/companion/index')}` });
        return;
      }
      const result = await presenceService.enter();
      if (this._disposed || !this._visible) return;
      this._presenceSessionToken = result.sessionToken;
      this._selfHighlightUntil = Date.now() + 2600;
      this.applySnapshot(result.snapshot, true);
      this.startHeartbeat();
    } catch (error) {
      if (!this._disposed) this.setData({ joining: false });
      if (!error.handled) wx.showToast({ title: error.message || '暂时无法加入星球', icon: 'none' });
    }
  },

  confirmJoinDisclosure() {
    return new Promise((resolve) => wx.showModal({
      title: '加入搭子星球',
      content: '加入后，你的昵称与已填写的公开资料可从星球短暂查看；离开页面后会自动隐身。不会公开完整生日、联系方式或实时位置。',
      confirmText: '确认加入',
      cancelText: '暂不加入',
      confirmColor: '#16A36A',
      success: (result) => resolve(Boolean(result.confirm)),
      fail: () => resolve(false)
    }));
  },

  async leavePresence() {
    if (this._leavePending) return;
    this._leavePending = true;
    this.stopHeartbeat();
    const sessionToken = this._presenceSessionToken;
    this._presenceSessionToken = '';
    try { if (sessionToken) await presenceService.leave(sessionToken); } catch (error) { /* TTL remains the correctness fallback. */ }
    this._leavePending = false;
    if (this._disposed) return;
    this.setData({ joined: false, joining: false, actionAriaLabel: actionCopy(false, this.data.onlineTotal) });
    this.loadSnapshot(false);
  },

  startHeartbeat() {
    this.stopHeartbeat();
    if (!this._visible || !this.data.joined) return;
    this._heartbeatTimer = setInterval(async () => {
      if (!this._visible || !this.data.joined || !this._presenceSessionToken) return;
      try {
        const result = await presenceService.heartbeat(this._presenceSessionToken);
        if (!result.joined && !this._disposed) {
          this._presenceSessionToken = '';
          this.setData({ joined: false, actionAriaLabel: actionCopy(false, this.data.onlineTotal) });
        }
      } catch (error) { /* A later heartbeat or TTL expiry safely converges state. */ }
    }, HEARTBEAT_INTERVAL_MS);
  },

  stopHeartbeat() {
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = null;
  },

  startSnapshotTimer() {
    if (this._snapshotTimer || !this._visible) return;
    this._snapshotTimer = setInterval(() => this.loadSnapshot(false), SNAPSHOT_INTERVAL_MS);
    if (this.data.joined) this.startHeartbeat();
  },

  stopRuntime(leave) {
    this.stopAnimation();
    this.stopHeartbeat();
    if (this._snapshotTimer) clearInterval(this._snapshotTimer);
    this._snapshotTimer = null;
    if (leave && this.data.joined && !this._leavePending) {
      this._leavePending = true;
      const sessionToken = this._presenceSessionToken;
      this._presenceSessionToken = '';
      if (sessionToken) presenceService.leave(sessionToken).catch(() => {}).finally(() => { this._leavePending = false; });
      else this._leavePending = false;
      if (!this._disposed) {
        this.setData({
          joined: false,
          joining: false,
          actionAriaLabel: actionCopy(false, this.data.onlineTotal)
        });
      }
    }
  },

  initCanvas() {
    if (this._canvas || typeof wx === 'undefined' || typeof wx.createSelectorQuery !== 'function') return;
    wx.createSelectorQuery().in(this).select('#companion-canvas').fields({ node: true, size: true, rect: true }).exec((result) => {
      const target = result && result[0];
      if (!target || !target.node || !target.width || !target.height || this._disposed) return;
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const dpr = Math.min(info.pixelRatio || 2, 2.5);
      const canvas = target.node;
      canvas.width = Math.round(target.width * dpr);
      canvas.height = Math.round(target.height * dpr);
      const context = canvas.getContext('2d');
      context.scale(dpr, dpr);
      this._canvas = canvas;
      this._context = context;
      this._canvasWidth = target.width;
      this._canvasHeight = target.height;
      this._canvasRect = { left: target.left || 0, top: target.top || 0, width: target.width, height: target.height };
      this._rotation = 0;
      this.startAnimation();
    });
  },

  refreshCanvasRect() {
    if (typeof wx === 'undefined' || typeof wx.createSelectorQuery !== 'function') return;
    wx.createSelectorQuery().in(this).select('#companion-canvas').boundingClientRect((rect) => {
      if (!rect || this._disposed) return;
      this._canvasRect = { left: rect.left || 0, top: rect.top || 0, width: rect.width, height: rect.height };
    }).exec();
  },

  startAnimation() {
    if (!this._visible || !this._canvas || this._animationFrame) return;
    this._lastFrameAt = 0;
    const frame = (timestamp) => {
      if (!this._visible || this._disposed || !this._canvas) return;
      const delta = this._lastFrameAt ? Math.min(50, timestamp - this._lastFrameAt) : 16;
      this._lastFrameAt = timestamp;
      this._rotation = (this._rotation + delta * Math.PI * 2 / REVOLUTION_MS) % (Math.PI * 2);
      this.drawScene(timestamp);
      this._animationFrame = this._canvas.requestAnimationFrame(frame);
    };
    this._animationFrame = this._canvas.requestAnimationFrame(frame);
  },

  stopAnimation() {
    if (this._canvas && this._animationFrame) this._canvas.cancelAnimationFrame(this._animationFrame);
    this._animationFrame = null;
    this._lastFrameAt = 0;
  },

  drawScene(timestamp) {
    const context = this._context;
    const width = this._canvasWidth;
    const height = this._canvasHeight;
    if (!context || !width || !height) return;
    context.clearRect(0, 0, width, height);
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * .39;
    this.drawSphereGuide(context, centerX, centerY, radius);
    const cosine = Math.cos(this._rotation || 0);
    const sine = Math.sin(this._rotation || 0);
    const projected = (this._nodes || []).map((node) => {
      const x = node.x * cosine + node.z * sine;
      const z = -node.x * sine + node.z * cosine;
      const scale = .72 + (z + 1) * .22;
      return { ...node, depth: z, scale, screenX: centerX + x * radius * scale, screenY: centerY + node.y * radius * .92 * scale };
    }).sort((left, right) => left.depth - right.depth);
    projected.forEach((node) => this.drawNode(context, node, timestamp));
    const frontNodes = projected.filter((node) => node.depth > .08).sort((left, right) => right.depth - left.depth).slice(0, MAX_VISIBLE_LABELS);
    const labelBounds = this.drawLabels(context, frontNodes, width, height);
    this._hitNodes = projected.filter((node) => node.depth > .05 && node.profileNavToken).map((node) => ({
      ...node,
      hitRadius: 22,
      textBounds: labelBounds.get(node.displayToken) || null
    }));
  },

  drawSphereGuide(context, x, y, radius) {
    context.save();
    context.lineWidth = 1;
    context.strokeStyle = 'rgba(164, 227, 224, .055)';
    context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.stroke();
    context.beginPath(); context.ellipse(x, y, radius * .34, radius, 0, 0, Math.PI * 2); context.stroke();
    context.beginPath(); context.ellipse(x, y, radius, radius * .28, 0, 0, Math.PI * 2); context.stroke();
    context.restore();
  },

  drawNode(context, node, timestamp) {
    const size = 2.4 + node.scale * 4.6;
    const alpha = .2 + (node.depth + 1) * .34;
    context.save();
    context.globalAlpha = Math.max(.16, Math.min(1, alpha));
    context.shadowColor = node.color;
    context.shadowBlur = node.depth > 0 ? size * 1.7 : 0;
    context.fillStyle = node.color;
    context.beginPath(); context.arc(node.screenX, node.screenY, size, 0, Math.PI * 2); context.fill();
    if (node.viewerIsSelf && Date.now() < Number(this._selfHighlightUntil || 0)) {
      const pulse = 9 + Math.sin(timestamp / 150) * 2;
      context.globalAlpha = .72;
      context.strokeStyle = '#6ee7d8';
      context.lineWidth = 1.5;
      context.beginPath(); context.arc(node.screenX, node.screenY, size + pulse, 0, Math.PI * 2); context.stroke();
    }
    if (node.displayToken === this._selectedDisplayToken && Date.now() < Number(this._selectedUntil || 0)) {
      context.globalAlpha = .9;
      context.strokeStyle = '#7ff5e5';
      context.lineWidth = 2;
      context.beginPath(); context.arc(node.screenX, node.screenY, size + 11, 0, Math.PI * 2); context.stroke();
    }
    context.restore();
  },

  drawLabels(context, nodes, width, height) {
    const occupied = [];
    const boundsByToken = new Map();
    context.save();
    context.textBaseline = 'middle';
    nodes.forEach((node) => {
      const fontSize = Math.round(11 + node.scale * 2.4);
      context.font = `600 ${fontSize}px sans-serif`;
      const label = String(node.nickname || '匿名搭子');
      const textWidth = Math.min(110, context.measureText(label).width);
      const x = node.labelSide > 0 ? node.screenX + 11 : node.screenX - textWidth - 11;
      const y = node.screenY - 8;
      const box = { left: x - 3, right: x + textWidth + 3, top: y - fontSize, bottom: y + fontSize };
      if (box.left < 4 || box.right > width - 4 || box.top < 4 || box.bottom > height - 4) return;
      if (occupied.some((other) => !(box.right < other.left || box.left > other.right || box.bottom < other.top || box.top > other.bottom))) return;
      occupied.push(box);
      boundsByToken.set(node.displayToken, box);
      context.globalAlpha = Math.min(.94, .48 + node.depth * .46);
      context.fillStyle = '#f5f1f5';
      context.shadowColor = 'rgba(0,0,0,.72)';
      context.shadowBlur = 4;
      context.fillText(label, x, y, 110);
    });
    context.restore();
    return boundsByToken;
  },

  handleCanvasTap(event) {
    if (this.data.status !== 'ready' || this._navigating) return;
    const point = resolveCanvasTap(event, this._canvasRect || {});
    const node = selectHitNode(point, this._hitNodes || []);
    if (!node) return;
    this._navigating = true;
    this._selectedDisplayToken = node.displayToken;
    this._selectedUntil = Date.now() + 500;
    if (node.viewerIsSelf) {
      this._navigationTimer = setTimeout(() => {
        wx.switchTab({
          url: '/pages/user/index',
          fail: () => { this._navigating = false; }
        });
      }, 100);
      return;
    }
    const key = ephemeralProfileNavigation.issue({
      profileNavToken: node.profileNavToken,
      profileNavExpiresAt: node.profileNavExpiresAt
    });
    this._navigationTimer = setTimeout(() => {
      wx.navigateTo({
        url: `/subpackages/profile/public/index?k=${encodeURIComponent(key)}`,
        fail: () => {
          ephemeralProfileNavigation.revoke(key);
          this._navigating = false;
          wx.showToast({ title: '暂时无法打开主页', icon: 'none' });
        }
      });
    }, 100);
  },

  handleRetry() { return this.loadSnapshot(true); },
  handleBack() { wx.navigateBack(); }
});
