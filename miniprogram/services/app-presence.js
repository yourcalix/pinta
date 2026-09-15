'use strict';

const userService = require('./user');
const presenceService = require('./companion-presence');

const HEARTBEAT_INTERVAL_MS = 30_000;
const RETRY_INTERVAL_MS = 15_000;

function createAppPresenceManager(overrides = {}) {
  const login = overrides.login || userService.login;
  const enter = overrides.enter || presenceService.enter;
  const heartbeat = overrides.heartbeat || presenceService.heartbeat;
  const leave = overrides.leave || presenceService.leave;
  const scheduleInterval = overrides.setInterval || setInterval;
  const cancelInterval = overrides.clearInterval || clearInterval;

  let epoch = 0;
  let foreground = false;
  let sessionToken = '';
  let heartbeatTimer = null;
  let retryTimer = null;
  let heartbeatPending = false;
  let startPromise = null;
  let startEpoch = 0;

  function stopHeartbeat() {
    if (heartbeatTimer !== null) cancelInterval(heartbeatTimer);
    heartbeatTimer = null;
    heartbeatPending = false;
  }

  function release(token) {
    if (!token) return Promise.resolve();
    return Promise.resolve(leave(token)).catch(() => {});
  }

  function isCurrent(targetEpoch) {
    return foreground && targetEpoch === epoch;
  }

  function stopRetry() {
    if (retryTimer !== null) cancelInterval(retryTimer);
    retryTimer = null;
  }

  function scheduleRetry(targetEpoch) {
    if (!isCurrent(targetEpoch) || sessionToken || retryTimer !== null) return;
    retryTimer = scheduleInterval(() => runAttempt(targetEpoch), RETRY_INTERVAL_MS);
  }

  function startHeartbeat(targetEpoch, token) {
    stopHeartbeat();
    if (!isCurrent(targetEpoch) || sessionToken !== token) return;
    heartbeatTimer = scheduleInterval(async () => {
      if (heartbeatPending || !isCurrent(targetEpoch) || sessionToken !== token) return;
      heartbeatPending = true;
      try {
        const result = await heartbeat(token);
        if (!isCurrent(targetEpoch) || sessionToken !== token) return;
        if (!result || result.joined !== true) {
          sessionToken = '';
          stopHeartbeat();
          runAttempt(targetEpoch);
        }
      } catch (error) {
        if (isCurrent(targetEpoch) && sessionToken === token
          && error && ['ACCOUNT_DISABLED', 'UNAUTHENTICATED'].includes(error.code)) {
          sessionToken = '';
          stopHeartbeat();
          stopRetry();
          release(token);
        }
        // Transient failures keep the last confirmed session until a later
        // heartbeat or TTL convergence, without exposing an error to the user.
      } finally {
        heartbeatPending = false;
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  async function beginSession(targetEpoch) {
    try {
      const user = await login();
      if (!isCurrent(targetEpoch) || !user || user.status !== 'ACTIVE') return;
      const result = await enter();
      const issuedToken = result && result.joined === true ? String(result.sessionToken || '') : '';
      if (!issuedToken) {
        scheduleRetry(targetEpoch);
        return;
      }
      if (!isCurrent(targetEpoch)) {
        await release(issuedToken);
        return;
      }
      sessionToken = issuedToken;
      stopRetry();
      startHeartbeat(targetEpoch, issuedToken);
    } catch (error) {
      // Login and Presence are best-effort app lifecycle work. Guest, disabled,
      // offline and transient failure states remain outside the online count.
      if (!error || error.code !== 'ACCOUNT_DISABLED') scheduleRetry(targetEpoch);
    }
  }

  function runAttempt(targetEpoch) {
    if (!isCurrent(targetEpoch) || sessionToken) return Promise.resolve();
    if (startPromise && startEpoch === targetEpoch) return startPromise;
    startEpoch = targetEpoch;
    const pending = beginSession(targetEpoch);
    startPromise = pending.finally(() => {
      if (startEpoch === targetEpoch) startPromise = null;
    });
    return startPromise;
  }

  function show() {
    if (foreground) return startPromise || Promise.resolve();
    foreground = true;
    const targetEpoch = ++epoch;
    return runAttempt(targetEpoch);
  }

  function hide() {
    foreground = false;
    epoch += 1;
    stopHeartbeat();
    stopRetry();
    const token = sessionToken;
    sessionToken = '';
    startPromise = null;
    startEpoch = epoch;
    return release(token);
  }

  function inspect() {
    return { epoch, foreground, online: Boolean(sessionToken) };
  }

  function ready() {
    return startPromise || Promise.resolve();
  }

  return { show, hide, inspect, ready };
}

const manager = createAppPresenceManager();

module.exports = {
  createAppPresenceManager,
  show: () => manager.show(),
  hide: () => manager.hide(),
  inspect: () => manager.inspect(),
  ready: () => manager.ready()
};
