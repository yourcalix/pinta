# GPT-5.5 后端分析摘要

## 推荐边界

- 新增 `profile.public.get`，只接受短期、不可伪造且绑定当前 presence session 的导航凭据。
- 凭据不得包含或可解码出 `userId/openid`，不得写入 Storage、日志或分享参数。
- 查询公开主页时必须重新确认 presence 仍为 ACTIVE、未过期、session 匹配，目标账号仍可用。
- token/在线状态/目标账号任一失败统一返回 `NOT_FOUND`，避免枚举 oracle。
- 公开 DTO 独立白名单，仅允许昵称、派生年龄、性别、MBTI、城市、兴趣、受控默认头像类型和 `viewerIsSelf`；禁止生日、联系方式、内部 ID、文件 ID、session 字段。
- 本人点击也消费同一 public DTO，避免意外返回私有资料。

## 实施注意

- 15 秒 `displayToken` 只适合渲染，不应直接作为长期主页标识。
- 导航凭据建议有效约 60 秒且不得超过 presence TTL；leave/re-enter 后旧凭据立即失效。
- 新页面只读，目标下线或凭据失效时显示统一安全失效态。
- Canvas 命中缓存仅保存在页面内存，前景优先、距离次优先；空白和背面弱点不跳转。

## 审查风险

- Critical：禁止把内部 ID 编码后下发；API 不能只验 token；禁止复用本人 DTO。
- Warning：避免 URL、日志和持久缓存泄漏 token；自定义头像是否公开需独立产品授权。
