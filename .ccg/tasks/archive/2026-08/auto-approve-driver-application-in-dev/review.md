# 开发环境司机认证自动通过复核

## 实现

- 仅当 `PINBA_ENV` 严格等于 `development` 或 `test`，且 `ENABLE_DEV_DRIVER_REVIEW` 严格等于字符串 `true` 时开启。
- 新申请经过原有字段校验、图片检查、文件归属校验和证件加密后，直接以 `APPROVED` 提交。
- 申请、加密敏感记录、上传绑定、司机、车辆和审计在同一 CloudBase 事务内写入。
- 自动通过与人工审核共用 `driverApprovalFacts`，司机和车辆使用确定性文档 ID。
- 同幂等键重放会补齐缺失的司机/车辆事实；旧 `SUBMITTED` 申请不会被隐式升级。
- 审计记录包含系统 actor、`DEV_AUTO_APPROVED`、开发环境名称和门禁启用状态，不包含证件原文或密钥。

## GPT-5.5 审查

- 推荐：开发/测试环境直接以 `APPROVED` 提交并同事务物化事实，禁止拆分为异步 review。
- Critical 条件：状态必须以持久化申请为根、事实使用确定性 ID、并发和幂等安全；均已落实并有测试。
- Warning 条件：严格字符串双门禁、不得绕过原有资料校验、旧申请只看 `application.status`、审计需记录环境与门禁；均已落实。

## 验证

- 专项测试：18/18 通过。
- 全量自动化：190/190 通过。
- JavaScript 语法检查通过。
- `git diff --check` 通过。
- 并发不同幂等键：仅一个申请成功，司机/车辆/自动审核审计各一份。
- 自动审核关闭：保持 `SUBMITTED`。
- 旧 `SUBMITTED`：新键返回 `DRIVER_APPLICATION_PENDING`，不自动升级。

## 云端部署

- 环境：`cloud1-d0giupmx3ce04ddd0`
- 云函数：`api`
- 部署成功：16 个文件，38.3 KB。
- 未清理、覆盖或迁移数据库数据。

## 结论

【可交付】。新提交的有效司机认证会在当前开发环境立即通过；生产环境仍默认关闭。
