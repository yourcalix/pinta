'use strict';

const directoryService = require('./directory-service');
const appPresence = require('../../../services/app-presence');
const userService = require('../../../services/user');
const ephemeralProfileNavigation = require('../../../services/ephemeral-profile-navigation');
const { calculateContentTopInset } = require('../../../utils/navigation-layout');
const { resolveCanvasTap, selectHitNode } = require('./hit-test');
const {
  GESTURE_MODE,
  beginGesture,
  updateGesture,
  finishGesture,
  cancelGesture,
  visualScaleForZoom
} = require('./gesture');

const MAX_RENDERED_USERS = 50;
const MAX_VISIBLE_LABELS = 18;
const SNAPSHOT_INTERVAL_MS = 20_000;
const DIRECTORY_REFRESH_INTERVAL_MS = 4 * 60_000;
const REVOLUTION_MS = 48_000;
const AUTO_SPIN_RADIANS_PER_MS = Math.PI * 2 / REVOLUTION_MS;
const INERTIA_FRICTION_PER_FRAME = .92;
const INERTIA_STOP_RADIANS_PER_FRAME = .001;
const AUTO_RESUME_DELAY_MS = 800;
const FRAME_MS = 1000 / 60;
const COLORS = ['#b9f4ef', '#f3d0d1', '#91dfdc', '#d9c7d7', '#c8eee9'];

function confirmedOnlineTotal(value, fallback = 0) {
  const total = Number(value);
  return Number.isFinite(total) && total >= 0 ? Math.floor(total) : Math.max(0, Number(fallback) || 0);
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
    users: [],
    accessibilityLabel: '搭子星球，正在读取真实用户目录'
  },

  onLoad() {
    this._disposed = false;
    this._visible = true;
    this._hasShown = false;
    this._directoryLoadSeq = 0;
    this._onlineLoadSeq = 0;
    this._hitNodes = [];
    this._navigating = false;
    this.resetGestureRuntime(true);
    this.setData({ contentTopInset: calculateContentTopInset(typeof wx === 'undefined' ? null : wx) });
    return appPresence.ready().then(() => this.loadDirectory(true));
  },

  onReady() { this.initCanvas(); },

  onShow() {
    this._visible = true;
    this._navigating = false;
    this.resetGestureRuntime(true);
    this.refreshCanvasRect();
    if (this._hasShown) {
      appPresence.ready().then(() => {
        if (this._disposed || !this._visible) return;
        this.loadDirectory(false);
        this.loadOnlineTotal();
      });
    }
    this._hasShown = true;
    this.startAnimation();
    this.startSnapshotTimer();
  },

  onHide() {
    this._visible = false;
    this.stopRuntime();
    this.resetGestureRuntime(true);
  },

  onUnload() {
    this._disposed = true;
    this._visible = false;
    this._directoryLoadSeq += 1;
    this._onlineLoadSeq += 1;
    if (this._navigationTimer) clearTimeout(this._navigationTimer);
    this.stopRuntime();
    this.resetGestureRuntime(true);
  },

  async loadDirectory(initial = false) {
    const seq = ++this._directoryLoadSeq;
    if (initial) this.setData({ status: 'loading' });
    try {
      const snapshot = await directoryService.snapshot();
      if (this._disposed || !this._visible || seq !== this._directoryLoadSeq) return;
      this.applyDirectory(snapshot);
    } catch (error) {
      if (this._disposed || !this._visible || seq !== this._directoryLoadSeq) return;
      if (initial || this.data.status !== 'ready') {
        this.setData({ status: 'error', accessibilityLabel: '寻找搭子星球暂时失联，请重新连接' });
      }
    }
  },

  applyDirectory(snapshot) {
    const users = Array.isArray(snapshot && snapshot.users) ? snapshot.users.slice(0, MAX_RENDERED_USERS) : [];
    const onlineTotal = confirmedOnlineTotal(snapshot && snapshot.onlineTotal);
    this._nodes = buildSphereNodes(users);
    this._hitNodes = [];
    this.setData({
      status: 'ready',
      onlineTotal,
      users,
      accessibilityLabel: `搭子星球，当前${onlineTotal}人在线，支持左右滑动旋转与双指缩放浏览`
    });
    this.startAnimation();
  },

  async loadOnlineTotal() {
    const seq = ++this._onlineLoadSeq;
    try {
      const snapshot = await directoryService.onlineSnapshot();
      if (this._disposed || !this._visible || seq !== this._onlineLoadSeq) return;
      const onlineTotal = confirmedOnlineTotal(snapshot && snapshot.onlineTotal, this.data.onlineTotal);
      this.setData({
        onlineTotal,
        accessibilityLabel: `搭子星球，当前${onlineTotal}人在线，支持左右滑动旋转与双指缩放浏览`
      });
    } catch (error) {
      // Presence polling is best-effort. Keep the last confirmed count instead
      // of flashing a false zero during a transient network failure.
    }
  },

  startSnapshotTimer() {
    if (this._snapshotTimer || !this._visible) return;
    this._snapshotTimer = setInterval(() => this.loadOnlineTotal(), SNAPSHOT_INTERVAL_MS);
    this._directoryTimer = setInterval(() => this.loadDirectory(false), DIRECTORY_REFRESH_INTERVAL_MS);
  },

  stopRuntime() {
    this.stopAnimation();
    if (this._snapshotTimer) clearInterval(this._snapshotTimer);
    this._snapshotTimer = null;
    if (this._directoryTimer) clearInterval(this._directoryTimer);
    this._directoryTimer = null;
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
      this.advanceRotation(delta);
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

  resetGestureRuntime(resetScale = false) {
    this._gesture = null;
    this._inertiaVelocity = 0;
    this._resumeAutoAt = 0;
    this._autoSpinBlend = 1;
    if (resetScale) this._zoomScale = 1;
  },

  scheduleAutoSpinResume() {
    this._inertiaVelocity = 0;
    this._resumeAutoAt = Date.now() + AUTO_RESUME_DELAY_MS;
    this._autoSpinBlend = 0;
  },

  advanceRotation(delta) {
    const gestureBlocksRotation = this._gesture && this._gesture.mode !== GESTURE_MODE.BYPASS;
    if (gestureBlocksRotation) return;
    const frameRatio = delta / FRAME_MS;
    if (Math.abs(this._inertiaVelocity || 0) >= INERTIA_STOP_RADIANS_PER_FRAME) {
      this._rotation = (this._rotation + this._inertiaVelocity * frameRatio) % (Math.PI * 2);
      this._inertiaVelocity *= Math.pow(INERTIA_FRICTION_PER_FRAME, frameRatio);
      if (Math.abs(this._inertiaVelocity) < INERTIA_STOP_RADIANS_PER_FRAME) this.scheduleAutoSpinResume();
      return;
    }
    if (Date.now() < Number(this._resumeAutoAt || 0)) return;
    const blendStep = 1 - Math.exp(-delta / 100);
    this._autoSpinBlend = Math.min(1, Number(this._autoSpinBlend || 0) + (1 - Number(this._autoSpinBlend || 0)) * blendStep);
    this._rotation = (this._rotation + delta * AUTO_SPIN_RADIANS_PER_MS * this._autoSpinBlend) % (Math.PI * 2);
  },

  drawScene(timestamp) {
    const context = this._context;
    const width = this._canvasWidth;
    const height = this._canvasHeight;
    if (!context || !width || !height) return;
    context.clearRect(0, 0, width, height);
    const centerX = width / 2;
    const centerY = height / 2;
    const zoomScale = Number(this._zoomScale) || 1;
    const visualScale = visualScaleForZoom(zoomScale);
    const radius = Math.min(width, height) * .39 * zoomScale;
    this.drawSphereGuide(context, centerX, centerY, radius);
    const cosine = Math.cos(this._rotation || 0);
    const sine = Math.sin(this._rotation || 0);
    const projected = (this._nodes || []).map((node) => {
      const x = node.x * cosine + node.z * sine;
      const z = -node.x * sine + node.z * cosine;
      const scale = .72 + (z + 1) * .22;
      return { ...node, depth: z, scale, visualScale, screenX: centerX + x * radius * scale, screenY: centerY + node.y * radius * .92 * scale };
    }).sort((left, right) => left.depth - right.depth);
    projected.forEach((node) => this.drawNode(context, node, timestamp));
    const frontNodes = projected.filter((node) => node.depth > .08).sort((left, right) => right.depth - left.depth).slice(0, MAX_VISIBLE_LABELS);
    const labelBounds = this.drawLabels(context, frontNodes, width, height);
    this._hitNodes = projected.filter((node) => node.depth > .05 && node.displayToken).map((node) => ({
      ...node,
      hitRadius: Math.max(18, 22 * visualScale),
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
    const size = (2.4 + node.scale * 4.6) * node.visualScale;
    const alpha = .2 + (node.depth + 1) * .34;
    context.save();
    context.globalAlpha = Math.max(.16, Math.min(1, alpha));
    context.shadowColor = node.color;
    context.shadowBlur = node.depth > 0 ? size * 1.7 : 0;
    context.fillStyle = node.color;
    context.beginPath(); context.arc(node.screenX, node.screenY, size, 0, Math.PI * 2); context.fill();
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
      const fontSize = Math.max(11, Math.min(16, Math.round((11 + node.scale * 2.4) * node.visualScale)));
      context.font = `600 ${fontSize}px sans-serif`;
      const label = String(node.nickname || '匿名搭子');
      const maxTextWidth = 110 * node.visualScale;
      const textWidth = Math.min(maxTextWidth, context.measureText(label).width);
      const gap = 11 * node.visualScale;
      const x = node.labelSide > 0 ? node.screenX + gap : node.screenX - textWidth - gap;
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
      context.fillText(label, x, y, maxTextWidth);
    });
    context.restore();
    return boundsByToken;
  },

  handleCanvasTouchStart(event) {
    if (this.data.status !== 'ready' || this._navigating) return;
    this._gesture = beginGesture(this._gesture, event.touches || [], this._canvasRect || {}, this._zoomScale || 1, Date.now());
    if (this._gesture && this._gesture.mode !== GESTURE_MODE.BYPASS) {
      this._inertiaVelocity = 0;
      this._resumeAutoAt = 0;
      this._autoSpinBlend = 0;
    }
  },

  handleCanvasTouchMove(event) {
    if (!this._gesture || this._navigating) return;
    const result = updateGesture(this._gesture, event.touches || [], this._zoomScale || 1, Date.now());
    this._gesture = result.gesture;
    this._zoomScale = result.scale;
    if (result.rotationDelta) this._rotation = (this._rotation + result.rotationDelta) % (Math.PI * 2);
  },

  handleCanvasTouchEnd(event) {
    if (!this._gesture || this._navigating) return;
    const result = finishGesture(this._gesture, event.touches || [], event.changedTouches || [], Date.now());
    this._gesture = result.gesture;
    if (result.action === 'tap') {
      this.scheduleAutoSpinResume();
      this.performCanvasHitTest(result.touch);
    } else if (result.action === 'inertia') {
      this._inertiaVelocity = result.angularVelocity;
      this._resumeAutoAt = 0;
    } else if (result.action === 'resume') {
      this.scheduleAutoSpinResume();
    }
  },

  handleCanvasTouchCancel() {
    if (!this._gesture) return;
    if (this._gesture.mode === GESTURE_MODE.BYPASS) {
      this._gesture = null;
      return;
    }
    const result = cancelGesture(this._gesture);
    this._gesture = result.gesture;
    this.scheduleAutoSpinResume();
  },

  async performCanvasHitTest(touch) {
    if (this.data.status !== 'ready' || this._navigating) return;
    const point = resolveCanvasTap({ changedTouches: [touch] }, this._canvasRect || {});
    const node = selectHitNode(point, this._hitNodes || []);
    if (!node) return;
    this._navigating = true;
    this._selectedDisplayToken = node.displayToken;
    this._selectedUntil = Date.now() + 500;
    try {
      const delay = new Promise((resolve) => { this._navigationTimer = setTimeout(resolve, 100); });
      if (node.viewerIsSelf) {
        await delay;
        wx.switchTab({ url: '/pages/user/index', fail: () => { this._navigating = false; } });
        return;
      }
      await userService.login();
      const [result] = await Promise.all([
        directoryService.createProfileNavigation(node.displayToken),
        delay
      ]);
      if (this._disposed || !this._visible) return;
      if (result.target === 'self') {
        wx.switchTab({ url: '/pages/user/index', fail: () => { this._navigating = false; } });
        return;
      }
      const key = ephemeralProfileNavigation.issue({
        profileNavToken: result.profileNavToken,
        profileNavExpiresAt: result.expiresAt,
        source: 'companion-directory'
      });
      wx.navigateTo({
        url: `/subpackages/profile/public/index?k=${encodeURIComponent(key)}`,
        fail: () => {
          ephemeralProfileNavigation.revoke(key);
          this._navigating = false;
          wx.showToast({ title: '暂时无法打开主页', icon: 'none' });
        }
      });
    } catch (error) {
      this._navigating = false;
      if (!error.handled) wx.showToast({ title: error.message || '主页访问已失效', icon: 'none' });
    }
  },

  handleRetry() { return this.loadDirectory(true); },
  handleBack() { wx.navigateBack(); }
});
