# 审查结果

审查模型：GPT-5.5（backend reviewer）

## Critical

无。

## Warning

无。

## Info

- 客户端 `MUTATING_ACTIONS` 已与云函数及 Mock 服务端保持一致。
- `api.invoke` 现在会为 `community.profile.nav.create` 自动生成并携带 `event.idempotencyKey`。
- 新增回归测试精确锁定该动作的写操作分类，防止再次遗漏。

## Verdict

APPROVE
