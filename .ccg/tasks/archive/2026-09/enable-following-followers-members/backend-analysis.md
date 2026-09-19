# GPT 5.5 后端架构分析摘要

## 根因

现有一期仅实现 `profile.follow.set`、`profile.public.get` 与双方计数，规范明确暂不提供关系列表。因此主页上的关注/粉丝统计不是链接，服务端也没有可供页面读取成员的 API。

## 推荐契约

- 新增只读 action：`profile.follow.list`。
- 输入仅允许 `type: FOLLOWING | FOLLOWERS`、不透明 `cursor` 与受限 `limit`；身份只从当前登录上下文取得，拒绝 `userId/openid/targetUserId` 等额外字段。
- 返回成员公开白名单、`nextCursor`、`hasMore`、当前用户权威 `followingCount/followerCount` 与 `serverNow`。
- DTO 禁止输出用户内部 ID、openid、关系文档 ID、联系方式、在线状态和精确位置。
- 游标必须绑定当前查看者与列表类型，按 `updatedAt desc + _id desc` 稳定分页。

## 数据层

- Memory/Cloud 新增同构 `listProfileFollows`。
- `FOLLOWING` 查询 `followerId + ACTIVE`，成员为 `targetUserId`。
- `FOLLOWERS` 查询 `targetUserId + ACTIVE`，成员为 `followerId`。
- CloudBase 需分别建立：
  - `followerId asc + status asc + updatedAt desc + _id desc`
  - `targetUserId asc + status asc + updatedAt desc + _id desc`
- 批量读取用户、过滤非 ACTIVE 或无可公开资料目标，并复用头像安全水合。
- `viewerFollowing` 与 `mutual` 由服务端关系事实计算，不能由客户端猜测。

## 主页凭据

- 新增语义独立的 `socialProfileNa_` 随机短期票据，不复用 `directoryProfileNa_`。
- 继续存入 `publicProfileNavTickets`，绑定 viewer、target、`socialProfile` 来源和有效期。
- `profile.public.get` 与 `profile.follow.set` 再次校验票据哈希、查看者、目标 ACTIVE 状态和有效期。

## 主要风险

- 内部 ID 泄露、游标跨用户/跨 Tab 复用、短期票据来源混用与前端本地计数漂移均属阻断问题。
- 60 秒主页票据在长停留列表中可能过期；前端需提供刷新重签的恢复路径。
- 列表上线前必须创建两个复合索引，否则真实 CloudBase 查询会失败。

## 建议测试

- 鉴权、额外字段、分页稳定性、游标绑定、停用账号过滤、单向/互关状态、票据过期/错查看者、DTO 隐私、Memory/Cloud/Mock 同构。
- 前端覆盖入口、空态、错误重试、分页、返回刷新、公开主页跳转和 320px/大字布局。
