# 新用户欢迎 IP 审查记录

## GPT-5.5 后端审查

- Critical：无。
- 已修复 Warning：本会话防重复标记原先只按 campaign 保存，切换账号时可能漏弹；现在由登录返回的脱敏 `sessionScope` 隔离，账号作用域变化和全局会话清理都会清空该标记。
- 产品策略确认：用户关闭后立即退场，ack 失败时本 App Session 不重复打扰；服务端继续保持 `PENDING`，下次冷启动或其他设备仍展示同一稳定 variant。这是既定失败语义，不改为弹层内阻塞等待。
- 非本任务项：现有本人 DTO 的 role/status 历史枚举归一化不属于 welcome DTO 泄露问题，本轮不扩大范围。
- 已修复 Info：Mock 的 welcome.ack 补齐字符串类型、长度、trim、额外字段和有限枚举校验。

## 前端审查

- 用户已从网页版 Gemini 3.7 Flash 贴回终审结果，Verdict 为 `APPROVE`，Critical：无。
- 已采纳 Warning：短屏断点由 `max-height: 620px` 扩展至 `680px`，覆盖 375×667 经典屏幕并改善大字模式的垂直余量。
- 已采纳 Warning：欢迎弹层关闭按钮与主按钮的原生 `::after` 边框统一改为 `border: none !important`，防止部分微信基础库叠加系统灰边。
- 关键契约复核通过：海报 `widthFix` 零裁切、旧账号不补弹、非首页深链不受欢迎层阻塞。

## 本地验证

- `npm run verify`：616 项测试中 615 通过、1 项既有迁移测试跳过、0 失败，项目结构检查通过。
- 微信开发者工具 CLI preview：成功；main 1.5 MB，onboarding 1.2 MB，异步跨分包组件编译通过。
