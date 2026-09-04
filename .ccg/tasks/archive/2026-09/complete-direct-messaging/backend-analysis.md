# GPT-5.5 后端分析摘要

## 已有闭环

- 会话只能由 `activityId + memberId` 创建，且创建和发送均在 Cloud 事务内重验活动及双方 ACTIVE 成员关系。
- 消息正文已执行本地格式约束、微信内容安全、联系方式/外链阻断和用户级限流。
- 消息 ID 由会话、服务端身份和客户端消息 ID 确定性派生；消息、会话预览和收件人未读增量同事务写入。
- 会话、消息、已读和举报均校验参与者，公开 DTO 不暴露内部用户 ID。
- 活动结束后历史可读、发送禁止；Cloud 失败不会自动回退 Mock。

## 必须补齐

1. README 增加 `directConversations`、`directMessages` 集合、只允许云函数访问的权限说明，以及三组复合索引。
2. 修复 Cloud 未读汇总每个参与者位置只扫描 100 条的截断问题。
3. `messagingAvailable` 同时依据活动状态和双方当前 ACTIVE 成员关系派生，避免先显示可发送、提交后才变只读。
4. 客户端同正文失败重试复用同一 `clientMessageId`，避免传输结果未知时产生重复消息。
5. 补会话分页、同时间戳、超过 100 会话未读、越权已读、状态矩阵、Mock 契约和 Cloud 不回退 Mock 测试。

## 需要真实 Cloud 验收

- `directConversations(participantAId ASC, updatedAt DESC, _id DESC)`。
- `directConversations(participantBId ASC, updatedAt DESC, _id DESC)`。
- `directMessages(conversationId ASC, createdAt DESC, _id DESC)`。
- 两个集合禁止小程序端直接读写，只允许聚合 API 云函数访问。
- 生产启用微信内容安全；验证并发发送、复合游标分页、条件已读和大量会话未读汇总。

## 主会话补充发现

- 当前聊天页只在进入时拉取一次消息，停留期间无法看到对方新消息；需增加页面可见期间的低频刷新并以消息 ID 去重。
- 当前未读刷新只覆盖消息页和我的页；应在五个 Tab 的 `onShow` 统一刷新，失败继续保留组件内最后确认值。
