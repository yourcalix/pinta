# 分域审查记录

## GPT-5.5 后端/安全审查

### 有效发现与修复

1. **会话作用域**：原会话 ID 仅由参与者派生，同一对用户在不同活动可能串用旧 source。已修改为 `activityId + sorted participants`。
2. **消息幂等作用域**：原消息 ID 缺少 conversation 维度，同发送者在多会话复用 clientMessageId 可能冲突。已修改为 `conversationId + senderId + clientMessageId`，Memory/Cloud 同时校验旧记录的 conversation、sender 和 payloadHash。
3. **已读并发安全**：保持 `message.list` 无副作用；聊天页成功展示后显式携带本次看到的 lastMessageId 标记已读。Store 事务仅在当前 lastMessageId 仍匹配时清零，避免并发新消息被误清。
4. **身份与举报**：`dm.conversation.read` 补齐完整资料/成年校验和 Service 参与者校验；`directConversation` 举报仅会话参与者可提交。
5. **TOCTOU**：Cloud 会话创建和消息发送事务内重验活动 `FORMED | IN_PROGRESS` 与双方 ACTIVE member 文档的 activityId/userId/status。Memory 同契约，Mock 同步收紧。
6. **Mock 隐私**：Mock conversation/message ID 改为不透明摘要，不再明文拼接内部用户 ID。

### 最终结论

- Critical：无。
- Warning：复审曾指出通知分支疑似重复，经核对实际源码为审查摘录压缩拼接假象，`notification.list` 与 `notification.read` 实际为独立分支。
- 回归：`npm test` 143 项，141 通过、2 项旧功能跳过、0 失败；`npm run check` 通过。

## Web Gemini 3.7 Flash 前端审查

### 审查结论

- Critical：无。
- Warning W-1：消息中心错误卡将底层“接口动作不存在”直接上屏。已改为固定友好文案“网络连接较慢或服务开小差了，请重试”，并增加静态回归断言。
- Warning W-2：聊天页 iOS/Android 软键盘顶升、最后一条消息滚动仍需真机验收。
- Info I-1：`99+` Badge 极值需真机或开发者工具注入状态验收；当前 CSS 使用最大 48rpx、胶囊形状和第 4 列内定位。
- TabBar：五等分、中央拼图越界、Safe Area、发现/消息选中态与系统通知/私信分层均通过截图审查。

### 结论

前端代码阻断项已关闭；剩余两项为上线前真机交互检查，不在无截图证据时伪造通过。
