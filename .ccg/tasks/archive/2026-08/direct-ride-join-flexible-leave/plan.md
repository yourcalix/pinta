# 实施计划

## 已确认的契约

1. 新增 `ride.join` 写动作；拼车不再通过 `application.submit -> application.approve` 入团。
2. `ride.join` 使用确定性 member ID，在 Store 原子边界内校验类型、发起者、报名截止、容量、重复成员并直接占位。
3. 曾经 `LEFT` 的成员允许在仍可加入且有容量时恢复为 `ACTIVE`。
4. 旧拼车 `PENDING` 申请在直接加入事务中收敛为 `APPROVED`，但不再对外展示等待审批流程；非拼车申请保持原逻辑。
5. 司机承接后只锁定已有成员的退出权限。按照既有产品决定，若仍未满 7 人且报名未截止，剩余乘客仍可直接加入。
6. `member.leave` 继续作为退出动作；对拼车由服务端 fulfillment 事实源返回 `RIDE_MEMBER_LOCKED`。
7. DTO 增加服务端计算的 `canJoinRide`、`canLeaveRide`、`rideExitLocked`，页面不得自行推导权限。

## 实施顺序

1. 新增后端和前端静态失败测试，覆盖直接加入、最后名额、重复加入、退出和司机承接锁定。
2. 扩展错误码、Store 和聚合服务，实现 Memory 与 Cloud 原子 `joinRideAtomic`。
3. 对齐 Mock 服务、客户端请求动作和展示模型。
4. 详情页删除拼车备注/勾选/等待审批，改为立即加入、退出确认和退出锁定信息卡。
5. 成团页退出入口改为服务端 `canLeaveRide`；锁定后展示静态说明。
6. 管理页对 ride 隐藏审批列表，展示容量与“乘客直接加入”说明；非 ride 保留审批。
7. 更新受影响的旧测试与规范，运行全量验证。
8. 调用 GPT-5.5 复审后端，并生成最终 Gemini 前端复审 Prompt。
