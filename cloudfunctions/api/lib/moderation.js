'use strict';

const { AppError } = require('./errors');

const DEFAULT_BLOCKED_PATTERNS = Object.freeze([
  /先付定金/i,
  /司机接单/i,
  /包赚|稳赚|返利/i,
  /陪玩交易|援交/i
]);

function createLocalModeration(options = {}) {
  const patterns = options.patterns || DEFAULT_BLOCKED_PATTERNS;
  return {
    async check(texts) {
      const joined = (texts || []).filter(Boolean).join('\n');
      if (patterns.some((pattern) => pattern.test(joined))) {
        throw new AppError('CONTENT_REJECTED');
      }
      return { accepted: true, provider: 'local-policy' };
    }
  };
}

function createWechatModeration(cloud, options = {}) {
  const enabled = options.enabled === true;
  const production = options.production === true;
  const fallback = createLocalModeration(options);
  return {
    async check(texts, context = {}) {
      const content = (texts || []).filter(Boolean).join('\n').slice(0, 2500);
      await fallback.check([content]);
      if (!enabled || !content) {
        if (production && !enabled) {
          throw new AppError('INTERNAL', '内容安全服务未配置，暂时无法提交');
        }
        return { accepted: true, provider: 'local-policy' };
      }
      try {
        const result = await cloud.openapi.security.msgSecCheck({
          content,
          version: 2,
          scene: context.scene || 2,
          openid: context.actorId
        });
        const suggest = result && result.result && result.result.suggest;
        if (suggest && suggest !== 'pass') throw new AppError('CONTENT_REJECTED');
        return { accepted: true, provider: 'wechat' };
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (production) throw new AppError('INTERNAL', '内容安全服务暂时不可用，请稍后重试');
        return { accepted: true, provider: 'local-policy-fallback' };
      }
    }
  };
}

module.exports = {
  createLocalModeration,
  createWechatModeration
};
