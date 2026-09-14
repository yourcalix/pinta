# GPT-5.5 后端分析摘要

- 不向社区帖子/回复 DTO 增加 `authorId`、`openid` 或稳定用户标识。
- 新增 `community.profile.nav.create`，仅接收 `sourceType + sourceId`，由服务端校验 ACTIVE 内容并反查作者。
- 本人返回 `target: self`；他人签发短期、随机且绑定当前访问者的公开主页凭据。
- 扩展既有 `profile.public.get`，同时兼容星球在线凭据与社区凭据；社区来源不得声明在线。
- Cloud 通过随机票据哈希文档 ID 精确读取，不扫描用户集合；读取时重新校验来源内容与目标账号状态。
- 覆盖本人分流、跨账号重放、过期、内容删除、旧星球凭据兼容与 DTO 脱敏测试。

以上结论来自本任务实施前通过 `codeagent-wrapper --backend gpt55 --gpt-model gpt-5.5` 完成的后端分析。
