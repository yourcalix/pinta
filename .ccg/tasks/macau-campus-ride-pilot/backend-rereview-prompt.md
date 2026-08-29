ROLE_FILE: ~/.claude/.ccg/prompts/gpt55/reviewer.md

<TASK>
你是 CCG 已调用的 GPT-5.5 外部后端最终复审者。不要再次调用外部模型或创建任务，只做当前工作区的只读代码复审。

请读取当前源码与 git diff，验证澳门校园拼车 MVP，尤其复核上一轮指出的事实源一致性问题是否已彻底修复：

1. `rideFulfillments` 集合/Map 是司机履约事实源，`activities.rideFulfillment` 只是缓存。MemoryStore 的申请、审批、列表、详情、退团不得依赖陈旧活动镜像。
2. CloudStore 的详情、申请、审批、列表、退团均读取实时 fulfillment；退团事务应从 fulfillment 文档水合后计算 `rideJoinable`。
3. Memory 列表不得在 raw cursor 之前按陈旧镜像过滤；应先按稳定查询条件排序，再水合实时 fulfillment，由 `collectPublicActivityPage` 的过滤阶段决定乘客/司机可见性，避免分页漏项。
4. Mock 的申请和审批必须共用 fail-closed `isMockRideJoinable`，缺失 fulfillment 也视为不可加入，不能把旧数据默认为开放。
5. Cloud 列表对 `command.in` 查询按不超过 10 个 activityId 分片，避免超过云数据库限制，并保持分页语义。
6. 同一行程仅一名审核通过司机与审核通过车辆可承接；接车后即禁止新增申请和待申请审批；并发返回稳定 `RIDE_ALREADY_ASSIGNED`。
7. 报名截止、整整 60 分钟窗口、15 分钟档、pickupAt 必须仍在未来；达到最低人数后可加入至最大 4 人，但司机锁定后关闭。
8. Cloud 满员审批后补偿失败时，已批准请求重放仍会再次执行待申请关闭，不永久遗留 PENDING。
9. 司机/车辆/活动公开 DTO 不泄露 openid、证件号、完整车牌、联系方式或内部审核字段。
10. 检查本轮修复有无新引入事务、幂等、分页、状态降级、旧数据兼容或客户端契约问题。

已执行 `npm run verify`：152/152 自动化测试通过，项目静态检查通过，`git diff --check` 通过。请不要仅依赖测试。
</TASK>

OUTPUT: Critical/Warning/Info 分级；每项给文件/代码路径、影响、最小修复。若无问题需明确写无。最后给“可交付 / 调整后可交付 / 不可交付”。
