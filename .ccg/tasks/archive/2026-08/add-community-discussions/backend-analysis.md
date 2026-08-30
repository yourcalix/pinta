# GPT-5.5 后端分析摘要

## 推荐架构

- 新建独立 `communityPosts` / `communityReplies` 领域，不复用 `activityQuestions` 集合。
- 复用现有 action 分发、公开 DTO、Moderation、幂等、审计、举报、分页和 Memory/Cloud 双 Store 模式。
- MVP 包含公开列表/详情、一层文字回复、作者软删除和举报；不包含分类、点赞、私信、图片、附件、外链、搜索、热度或分享统计。

## 推荐 actions

- `community.post.list`
- `community.post.detail`
- `community.post.create`
- `community.reply.create`
- `community.post.delete`
- `community.reply.delete`
- 扩展 `report.create` 的社区帖子/回复目标类型。

## 关键安全结论

- 帖子与回复的 Moderation 必须 fail-closed。
- 公开 DTO 必须通过专用 mapper，禁止返回 openid、电话、审核原因、幂等 hash 或内部状态。
- 回复创建/删除与 `replyCount` 必须在同一事务边界完成。
- 作者删除只做软删除，保留审计与举报证据。
- 服务端拦截 URL、手机号、微信号、邮箱、群号等引流内容。
- 登录且资料完整用户才可发帖/回复；公开读取免登录。

## 分页与索引

- 帖子：`createdAt DESC, _id DESC`，复合游标包含时间和 ID。
- 回复：`createdAt ASC, _id ASC`，复合游标包含时间和 ID。
- CloudBase 索引至少覆盖帖子公开列表、作者内容、回复按帖子分页和举报自然键。

## 测试重点

- 同时间戳稳定分页、非法游标、limit 夹紧。
- 内容审核拒绝/不可用、联系方式和外链拦截。
- 同幂等键重放与 payload 冲突。
- 回复计数创建/删除/并发一致性。
- 作者权限、软删除、下架不可见、举报目标扩展。
- MemoryStore 与 CloudStore 行为一致及既有 activityQuestions 回归。
