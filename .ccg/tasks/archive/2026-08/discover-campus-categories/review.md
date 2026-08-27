# 审查记录

## GPT-5.5 后端审查

- Critical：无。
- Warning：Cloud 校区/路线查询未强制 ride-only；不兼容的 campusId + routeId 使用哨兵；Mock 路线过滤未限定 ride；Mock 新建拼车 DTO 缺少起终点 ID。
- Info：建议增强 Cloud 条件模拟、双向校区路线测试，并补充生产复合索引说明。

## 已落实修复

- Cloud 在存在 campusId/routeId 时强制 `type = ride`；显式非 ride 或不兼容组合直接返回空页。
- Mock 校区/路线过滤限定拼车类型，新建拼车写入起终点 ID。
- Cloud 测试实际执行 equality / `$in` 条件并断言返回项；Mock 测试覆盖校区作为起点与终点的双向路线。
- README 增加 `type + status + typeData.routeId + startsAt` 索引建议。
- `npm run verify`：165/165 测试通过；静态检查通过；`git diff --check` 通过。

## Gemini 3.7 Flash 前端审查

- Critical：无。
- Warning：建议清除原生 button 的 `::after` 边框；建议将 `aria-role` 改为 Web `role`。
- Info：320px 与大字号下三等分布局空间充足；状态切换与四类空状态闭环完整。

## 主会话综合

- `miniprogram/app.wxss` 已全局声明 `button::after { border: 0; }`，因此不存在双边框，无需重复局部样式。
- 不采纳将 `aria-role` 改为 `role`：微信小程序无障碍组件契约与腾讯官方 WeUI 示例均使用 `aria-role`，现有写法正确。
- 结论：无 Critical、无待修 Warning，功能可交付。
