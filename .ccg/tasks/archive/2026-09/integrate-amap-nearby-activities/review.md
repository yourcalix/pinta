# 审查记录

## GPT-5.5 后端 / 安全 / 数据库复审

- 最终结论：`APPROVE`
- Critical：无
- Warning：无
- 已闭环：顶层 `meetingGeoPoint` 写入与 `geoNear` 查询、公开 DTO 坐标隐藏、稳定 keyset 游标、查询指纹绑定、历史类型映射、Mock / Memory / Cloud 契约一致性。
- 有意保留的兼容边界：服务端仍接受旧客户端不携带 `meetingPoint`；该类记录保留在全城列表，但不会出现在附近查询。新版三类发布 UI 强制选择结构化高德 POI。
- 上线注意：历史数据如需进入附近查询，迁移必须同时写入顶层 `meetingGeoPoint`，并为该字段创建云数据库地理位置索引。

## 自动验证

- `npm run verify`：371 pass，1 historical skip，0 fail。
- 静态检查：257 JSON、163 JS、25 WXML，全部通过。
- `git diff --check`：通过。
- 包体：主包 1.618 MiB；发布分包 1.185 MiB；活动分包 0.127 MiB。

## Web Gemini 3.7 Flash 前端审查

- 首轮结论：正文包含 1 Critical、1 Warning、1 Info，尾部 Verdict 为 `APPROVE`；按更严格的正文分级处理。
- Critical（原生 map 可能压盖搜索交互）：当前地图原本只在已选 POI 后出现，联想结果不是浮层；仍新增 `showMapPreview`，用户再次输入或搜索时条件销毁原生 map，选中 POI 后才恢复预览。
- Warning（旧 POI 请求覆盖新结果）：原实现已有 `_searchSeq`，但清空输入未使在途请求失效；现改为每次输入立即递增序列号，并补旧响应回写回归测试。
- Info（附近筛选快速切换）：原实现已有 `_requestSeq` 丢弃旧查询；额外修复筛选打断续页时 `loadingMore` 可能残留的问题，并补竞态测试。
- 最终复审：Critical 无，Warning 无，Verdict `APPROVE`。
- 复审确认：条件销毁原生 `map`、普通文档流结果列表、`_searchSeq` / `_requestSeq` 以及 `loadingMore` 全路径重置共同保证了原生层级与异步竞态下的状态收敛。
