# 审查记录

## 自动验证

- `npm run verify`：通过；501 项测试中 500 pass、1 个既有 skip、0 fail。
- `node scripts/check-project.js`：通过；JSON / JS / WXML 结构检查正常。
- 主包与所有分包体积预算测试：通过，未提高预算。
- 两张首页 PNG 仅做像素零差异的无损压缩，`compare -metric AE` 均为 0。
- `git diff --check`：通过。

## GPT 5.5 后端与安全审查

最终结论：`APPROVE`，无 Critical、无 Warning。

- 首轮指出前台首次登录/进入瞬时失败不会恢复；已加入 15 秒前台重试，成功或进入后台即清理，epoch 阻止旧异步结果覆盖新会话。
- 次轮指出账号在前台会话中被停用后的收敛；服务端心跳现会先按会话令牌标记 Presence 为 `INACTIVE` 再返回 `ACCOUNT_DISABLED`，客户端同步清空闭包令牌并停止定时器。30 秒心跳与 90 秒 TTL 构成有界兜底。
- 最终复审确认目录/P​​resence 解耦、资料未完善 ACTIVE 用户计数、会话令牌零持久化、短时主页票据与 Mock/正式契约均无阻断问题。

## Gemini 3.7 Flash 前端审查

最终结论：`APPROVE`，无 Critical、无 Warning。

- 确认 App 级 Presence 的 `epoch`、`startEpoch` 与闭包状态可防止快速切前后台时旧 `enter`/心跳污染新会话。
- 确认心跳、重试定时器与 `heartbeatPending` 锁不存在明显重复或泄漏路径。
- 确认 `ready()` 只等待当前首次尝试，不会因后续重试让星球首屏永久 Loading。
- 确认删除操作按钮后，Canvas 舞台使用 `flex: 1; min-height: 0`，底部状态区使用 `flex-shrink: 0` 与 Safe Area，在 320px 和系统大字模式下结构合理。
- 确认星球页已彻底移除目录总数、抽样提示、手动 Presence 操作以及会话令牌，仅保留只读目录与在线总数轮询。
