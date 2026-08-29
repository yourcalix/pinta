# 真实 CloudBase 拼车直接入团修复复核

## 根因

真机前端使用新契约严格消费 `canJoinRide`，但开发环境的 `api` 云函数仍为旧版，响应缺少该字段。`undefined === true` 按安全原则收敛为不可加入，因此出现“招募中，暂不可加入”。

## 修复

- 服务端继续以 `canJoinRide` 作为唯一加入权限事实，新增稳定、脱敏的 `joinUnavailableReason`。
- 前端对缺少布尔型 `canJoinRide` 的旧响应继续 fail-closed，但显示“服务更新中，请刷新后重试”，不再显示矛盾状态。
- Mock 与真实服务对齐满员、截止、取消、过期和畸形时间的原因契约。

## 验证与部署

- JavaScript 语法检查通过。
- 全量自动化测试 199/199 通过。
- 完整目录部署遇到微信开发者工具 CLI `EISDIR` 打包缺陷；使用与源码等价的临时 esbuild 单文件包部署成功，`wx-server-sdk` 保持 external 并交由云端安装。
- 官方 CLI 返回 `success=true`、`filesCount=3`、`packSize=28.3KB`。
- 部署后回读：函数状态 `Active`，超时 15 秒，运行时 `Nodejs16.13`。
- 临时 staging 目录已清理；未修改数据库数据或环境变量。

## CCG 复审

- 网页版 Gemini 3.7 Flash 确认根因为新前端与旧云函数契约错配，并要求保持 fail-closed。
- GPT-5.5 最终复审：Critical 无，Warning 无，可部署。

## 结论

【可交付】。剩余人工验证为：使用非发起者账号重新打开未满 7 人且未截止的行程，确认出现行李选择与“立即加入拼车”按钮。
