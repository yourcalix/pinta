# GPT-5.5 后端架构分析摘要

## 推荐方案

- 原生 TabBar 调整为：发现 / 社区 / 发布 / 消息 / 我的，发布固定第 3 项。
- 私信采用受业务关系约束的一对一纯文字会话；conversation 是授权边界，message 只能在已授权会话内创建和读取。
- 不接受裸 `targetUserId` 建会话，不支持用户搜索或 ID 枚举。
- 首期优先只允许活动组织者与已确认活动成员、同活动成员之间发起私信；社区作者私信后置。
- 发送者 ID 仅取登录上下文，客户端必须提交 `clientMessageId` 供服务端幂等。
- 会话、消息分别采用稳定复合游标分页；未读数由独立权威接口提供，Native TabBar badge 不使用假数据。
- 内容安全失败默认拒绝发送；禁止外链、手机号、微信号、QQ 和邮箱等引流内容。

## 必须权限断言

- 当前用户必须登录、账号可用、资料完整并确认年满 18 岁。
- 会话读取、消息读取、发送、已读与举报均要求当前用户属于该会话。
- 从活动入口建会话时，后端根据 activity 事实解析并校验双方成员关系，不能信任前端提交的成员身份。
- 屏蔽后禁止新建会话和继续发送；不存在与无权限统一返回防枚举错误。
- 标记已读只能修改当前用户的 readState/unread，不得修改对方。

## 建议接口

- `dm.getUnreadSummary`
- `dm.listConversations`
- `dm.createConversation`
- `dm.getConversation`
- `dm.listMessages`
- `dm.sendMessage`
- `dm.markConversationRead`
- `dm.deleteConversationForMe`
- `dm.blockUser` / `dm.unblockUser`
- `dm.reportConversation`

撤回、单条仅自己删除可在首期之后追加，降低首版复杂度。

## 实施顺序

1. 会话/消息数据契约与权限规则。
2. MemoryStore、CloudStore 与 Mock 行为对齐。
3. Service actions 与前端 DM service。
4. 五栏 TabBar 和消息中心。
5. 聊天详情分包。
6. 从安全的活动成员关系入口逐步开放私信。

## 关键风险

- Critical：开放裸用户 ID 建会话、伪造 senderId、越权读取会话。
- Critical：Mock 与 Cloud 权限规则不一致。
- Critical：无内容安全或联系方式过滤即上线发送。
- Warning：只上线消息空态却让用户误以为私信已可用。
