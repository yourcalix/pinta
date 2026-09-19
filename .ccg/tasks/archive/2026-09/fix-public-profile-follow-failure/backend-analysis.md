# 后端诊断与修复结论

## 已确认事实

- 小程序本地运行配置为真实 Cloud 模式：`useMock: false`，目标函数为 `api`。
- 前端点击关注调用 `profile.follow.set({ profileNavToken, following })`，并正确执行乐观更新、失败回滚和防重锁。
- 服务端当前仓库实现会在一个事务中写入 `profileFollows`、双方 `users` 计数和 `auditLogs`。
- Memory、Mock 与服务层关注测试通过；通用“操作失败”代表服务端返回了非 `NOT_FOUND` 异常。
- README 要求手动创建 `profileFollows` 集合。
- 用户开启微信开发者工具服务端口并授权后，已通过官方客户端连接到真实开发环境。
- 单集合 `checkCollection(profileFollows)` 曾错误返回存在；权威 `listCollections` 未列出该集合，真实只读请求进一步返回 `Db or Table not exist: profileFollows`。
- 因此本次线上失败的确定根因是生产 CloudBase 环境缺少 `profileFollows` 集合，关注事务被归一为 `INTERNAL`，前端按既有安全策略显示“操作失败，请稍后重试”。

## 修复内容

1. 已在目标 CloudBase 环境创建 `profileFollows` 集合。
2. 已部署当前 `cloudfunctions/api`。
3. 将关注事务内两个用户文档的并发读取改为顺序读取，避免 CloudBase 事务 SDK 并发文档操作的兼容风险；关系、双方计数与审计仍保持在同一事务内。
4. 增加静态回归断言，防止关注事务再次引入 `Promise.all` 并发读取。
5. README 与后端 Spec 增加权威集合事实校验要求，防止新环境重复漏建。

## 真实环境验证

- 使用真实登录账号从讨论详情重新打开他人公开主页，点击关注后页面变为 `viewerFollowing: true`，粉丝数从 0 更新为 1。
- 再次点击取消关注后页面恢复为 `viewerFollowing: false`，粉丝数恢复为 0；测试关系当前为非激活状态。
- 当前一期按确定性 `_id` 精确读写，无需新增索引。
- `npm run verify`：578 项，577 pass、1 skip、0 fail。

## 外部审查

GPT-5.5 后端审查无 Critical，结论为通过；建议保留顺序读取，并将集合创建沉淀为发布校验。测试中的源码格式断言作为短期回归锁保留，后续若重构事务工具再升级为语义化测试。本问题未修改前端，因此不触发网页版 Gemini 前端审查。
