# 后端分析与主会话核查

## GPT-5.5 输出边界

GPT-5.5 完成了契约层分析，但其隔离沙箱未能读取仓库，因此其“回复分页缺失”等结论只能作为风险提示，不能视为代码事实。主会话已逐项读取现有实现并修正如下。

## 现状事实

### 私信

- 已有未读汇总、会话分页、基于共同活动成员关系建会话、消息分页、发送、条件已读。
- 已有确定性消息ID、正文绑定幂等、事务内消息/会话预览/未读更新、轮询、跨页追赶、草稿保护、失败重试与生命周期清理测试。
- 现阶段不重构，只补门禁/审核/入口/Mock与Cloud契约回归；不做陌生人私信、在线状态、已读回执和图片消息。

### 社区

- 已有公开帖子列表、帖子详情、纯文字发帖、纯文字一层回复、作者软删除、举报、内容审核、外链/联系方式拒绝、频率限制、写入幂等。
- Store和API已经支持帖子与回复的createdAt+ID稳定游标，`community.post.detail`已返回`nextCursor`；缺口是详情页没有消费续页，也没有局部续页状态和去重。
- 缺少帖子/回复点赞事实集合、点赞/取消点赞动作、`likeCount`、`viewerHasLiked`及对应Mock/Cloud/UI测试。
- 列表只展示回复数；详情页一次拉取30条回复并在本地追加新回复，缺少服务端事实刷新、续页竞态保护与写入失败的完整局部状态。

## 建议契约

- 新增`communityLikes`事实集合，确定性ID由`targetType + targetId + actorId`派生；字段至少含targetType、targetId、postId、actorId、status、createdAt、updatedAt。
- 新增单一动作`community.like.set`：`{targetType: 'post'|'reply', targetId, liked}`，服务端返回`{targetType,targetId,liked,likeCount}`。自然键负责业务幂等，通用mutating idempotency继续防不确定响应重放。
- 帖子/回复持久化`likeCount`，点赞事实与计数必须在同一事务更新；重复点赞/取消不重复加减且计数不低于0。事务内只用确定性`doc(id)`，不使用`where()`。
- DTO统一返回`likeCount`；登录查看详情时返回`viewerHasLiked`，游客固定false。帖子列表本轮可只展示计数，不要求列表批量查询viewer态，避免额外N+1。
- 详情继续复用`community.post.detail`的cursor/limit/nextCursor，不另造回复列表动作。客户端续页按ID去重，replace抢占旧请求，append只复用当前详情序号。
- 发帖、回复、点赞、取消点赞、删除与举报都要求ACTIVE账号；发帖/回复/点赞门禁保持完整资料和成年确认。已删除/下架目标统一不可互动，不泄露内部处置原因。

## 风险分级

### Critical

- 点赞事实、事务计数及DTO完全缺失，是当前互动闭环的主要阻断项。

### Warning

- 详情页未消费已有回复游标，30条之后不可达。
- 新回复目前只局部追加，缺少与续页/刷新并发的ID去重和请求序号保护。
- 删除和点赞并发必须由Cloud事务串行校验目标ACTIVE状态；Mock需对齐同样语义。

### Info

- 私信现有架构已较完整，本轮以回归验证为主，不扩大为通用陌生人社交系统。
- 采用一层按时间正序回复，不新增楼中楼，避免扩大通知、删除与分页复杂度。

