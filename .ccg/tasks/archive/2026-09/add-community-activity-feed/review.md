# 讨论动态交叉审查

## 后端 GPT 5.5

- Critical：无。
- Warning：CloudBase `or` 游标查询的索引可行性、30 天措辞、幂等回复重放补写动态。
- 处理：游标改为“同时间边界 + 更早时间”两次索引查询后稳定合并；README 明确仅展示近 30 天、历史保留由独立策略负责；幂等命中不再补写动态。
- 结论：收件人隔离、事务写入、自回复/自赞排除、点赞聚合、已读权限和 DTO 脱敏成立。

## Web Gemini 3.7 Flash

- Critical：无。
- Warning：头像角标可能被圆形容器裁切；已读卡片快速双击可能重复入栈。
- 处理：现有结构已经使用不裁切的 `.activity-avatar-wrap` 外层承载角标，头像自身单独圆形裁切；新增 `_navigationPending` 页面级锁，导航失败或返回页面时复位。
- Verdict：`APPROVE`。

## 验证

- `npm run verify`
- 448 项自动化测试：447 pass、1 个既有 skip、0 fail。
- 项目静态检查：JSON 292、JS 185、WXML 28，状态 `ok`。
