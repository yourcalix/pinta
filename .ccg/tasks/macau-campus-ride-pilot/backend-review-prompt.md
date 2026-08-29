ROLE_FILE: ~/.claude/.ccg/prompts/gpt55/reviewer.md

<TASK>
请审查当前工作区中澳门校园拼车 MVP 的后端变更。你需要自行读取 git diff，重点检查：

1. 固定 8 条路线、最低成团 2 人、最大乘客 4 人、成团后满员前仍可加入的状态与容量契约。
2. 司机只能承接已成团行程，必须通过司机与车辆审核，生产环境默认 fail-closed，且同一行程仅一名司机可承接。
3. CloudBase 事务中是否只使用 doc 级读写，并发、幂等、审计失败恢复与状态镜像 rideJoinable / rideFulfillment 是否一致。
4. 60 分钟时间窗、15 分钟时段、跨日时间、截止时间与取消后恢复待承接的边界。
5. 公开 DTO 不得泄露 openid、驾驶证号、完整车牌、联系方式或内部审核字段。
6. MemoryStore、CloudStore 和 miniprogram Mock 的行为契约是否对齐。

已执行 npm test，139/139 通过。请不要仅依赖测试，需审阅实现。
</TASK>

OUTPUT: 以 Critical / Warning / Info 分级输出。每项给出文件与具体代码路径、用户/数据影响、最小修复方案。最后给出“可交付 / 调整后可交付 / 不可交付”结论。
