# 后端分析结论

## 一期范围

- 他人公开主页支持关注与取消关注。
- “我的”主页展示关注数与粉丝数。
- 他人公开主页展示关注数、粉丝数与当前查看者是否已关注。
- 一期不加入关注/粉丝列表页、私信、关注通知或推荐算法。

## 安全与数据模型

- 新增 `profileFollows` 集合，使用 `stableEntityId('profileFollow', followerId, targetUserId)` 作为确定性文档 ID。
- 文档保存 `followerId`、`targetUserId`、`ACTIVE | DELETED` 状态及时间戳。
- `users` 文档物化 `followingCount` 与 `followerCount`，缺失值按 0 读取。
- 关注写入只接受当前公开主页的 `profileNavToken` 和布尔值 `following`，绝不接受客户端传入的用户 ID、openid 或关系 ID。
- `profile.public.get` 与 `profile.follow.set` 必须复用同一个服务端票据解析器，重新校验查看者绑定、目标、来源状态和有效期。

## 原子性

- Cloud Store 在一个事务中读取双方用户与确定性关系文档。
- 只有关系状态发生变化时才对双方计数应用 `+1` 或 `-1`；重复关注/重复取消返回成功但 delta 为 0。
- 禁止自关注；目标禁用、资料缺失、票据过期或社区来源失效时拒绝写入。
- Memory Store 与 Mock Server 保持同一契约。

## 推荐动作

- `profile.follow.set({ profileNavToken, following })`
- 返回 `{ following, followerCount, followingCount, serverNow }`。
- `profile.get` 的自有 DTO 增加 `followingCount`、`followerCount`。
- `profile.public.get` 的公开 DTO 增加 `followingCount`、`followerCount`、`viewerFollowing`。

## 数据库与测试

- 一期确定性 `_id` 读写无需额外索引；为二期列表预留：
  - `followerId + status + updatedAt desc + _id desc`
  - `targetUserId + status + updatedAt desc + _id desc`
- 覆盖三类主页票据、幂等关注/取消、自关注、封禁、过期、来源删除、并发计数、Mock 对齐及 DTO 不泄露身份等测试。
