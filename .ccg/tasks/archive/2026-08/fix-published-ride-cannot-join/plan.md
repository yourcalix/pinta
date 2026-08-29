# 实施计划

1. 服务端与 Mock 返回稳定的 `joinUnavailableReason`，不改变 `canJoinRide` 权限判定。
2. 前端对缺失 `canJoinRide` 的旧响应保持 Fail-closed，并显示“服务更新中，请刷新后重试”。
3. 增加契约、文案与状态矩阵回归测试。
4. 全量测试通过后部署 `api` 云函数至已配置的 CloudBase 开发环境。
5. 复核云函数信息并提供真机验证步骤。
