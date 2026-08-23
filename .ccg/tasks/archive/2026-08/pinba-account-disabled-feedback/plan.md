# 实施计划

## 1. 测试骨架

- 新建 `tests/account-disabled-feedback.test.js`。
- 覆盖非受限错误、并发 Modal 去重、确认后单次 `switchTab`、Modal/导航异常解锁。
- 通过 API + Mock 集成验证 `error.handled`、全局用户清理，以及其他结果未知 pending 幂等键仍保留。
- 静态覆盖受保护页面的双提示防护和举报页 `finally`。

## 2. 底层反馈服务

- 新建 `miniprogram/services/account-disabled-feedback.js`。
- 提供可注入 `platform` 的工厂，默认使用 `wx`。
- 使用共享 Promise 作为单例锁；Modal 完成后进入发现 Tab，导航完成后释放锁。
- 所有平台异常在服务内部结算，不产生未处理 Promise rejection。

## 3. API 会话拦截

- 修改 `miniprogram/services/api.js`。
- 保持当前请求的幂等清理顺序；确认 `ACCOUNT_DISABLED` 后清空 actor scope 和 `globalData.user`。
- 调用单例反馈并设置 `error.handled = true`，然后继续抛出。
- 不清空其他 pending mutation 记录。

## 4. 页面降级与状态恢复

- 修改发布 Tab、我的、资料、发布表单、详情、申请管理、成团、举报页面。
- 已处理错误不再叠加 Toast 或原始内联错误；加载页使用安全占位，避免空用户进入正常内容。
- 通知标记已读遇到受限错误时停止后续导航。
- 举报提交增加 `finally`，所有 return/error 路径恢复 `submitting`。

## 5. 验证与审查

- 运行针对性测试、`npm run verify`、结构检查、diff/sensitive scan。
- 前端实际 diff 交网页版 Gemini 3.7 Flash 复审。
- auth/会话代码尝试 GPT 5.5 reviewer；若外部通道仍不可用，如实记录。
- 修复 Critical/Warning 后更新 Spec、review.md，归档并提交。
