# 审查记录

## GPT 5.5 后端与状态机分析

- 现有 `community.activity.read`、`community.activity.list` 与 `community.activity.unread` 契约已经足够，无需修改或重新部署云函数。
- 根因是详情页已读写入与返回页面 `onShow` 读取之间缺少因果顺序；推荐在前端社区 service 中建立在途已读 Promise 屏障。
- `stale: true` 表示活动版本已变化且当前版本未被清除，不能本地消红点或扣减数字。
- 网络失败不是已读证据，所有页面必须保留上一次确认状态。

## Web Gemini 3.7 Flash 方案与终审

- 认可 Service Read Barrier，确认无需 `EventChannel` 或固定延时二次刷新。
- 建议为屏障增加 2000ms 熔断，避免极端弱网让动态列表和发现页长期阻塞。
- 确认 `tracked.then(release, release)` 能在成功、业务 stale、异常和超时后释放 Set 引用，不产生未处理 rejection。
- 确认调用时 Promise 快照足以覆盖“详情返回触发 onShow”的单向时序，并避免无界等待。
- Critical：无；Warning：无；Verdict：`APPROVE`。

## 主会话复核

- `readActivity` 发起后立即登记在模块级 Set；`listActivities` 和 `getActivityUnread` 在请求权威快照前等待当前写入结算。
- 动态页、发现页铃铛和消息页讨论入口均复用上述两个读取方法，无需页面间私有通信。
- 屏障等待超过 2 秒即放行读取；后端写入失败或超时后不会伪造已读。
- 失效动态仅在 `read === true && stale !== true` 时本地清除红点，stale 仍刷新权威汇总但保留未读。
- 工作区中既有的 `.ccg/tasks/configure-wechat-amap-production/` 未纳入本任务。

## 验证

- 核心读写屏障与未读测试：9/9 通过。
- 社区与消息相关回归：121/121 通过。
- 全量 `npm run verify`：540 项测试，539 pass，1 个既有 skip，0 fail。
- 静态项目检查：通过（324 JSON、204 JS、28 WXML）。
- `git diff --check`：通过。
