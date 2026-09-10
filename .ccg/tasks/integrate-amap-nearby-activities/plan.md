# Plan

## 1. 先建立失败测试

- 新增地理契约测试：会合地点校验、澳门边界、GCJ-02、距离计算、附近排序、半径过滤、无坐标历史兼容、DTO 精确坐标隔离。
- 新增 Cloud Store 测试：创建时物化 GeoPoint，附近查询使用 `geoNear`，索引缺失错误安全归一。
- 新增 Mock 对等测试：`activity.nearby` 与正式服务字段、过滤、排序和游标一致。
- 新增前端测试：首页入口重分工、附近页授权五态、查看者坐标不持久化、高德配置与 POI 解析、三类表单强制结构化选点。

## 2. 建立共享地理领域规则

- 新增后端地理纯函数：坐标校验、澳门边界、Haversine 米制距离、距离标签和查询绑定游标。
- 扩展 `validateActivityInput` 兼容可选 `meetingPoint`，扩展 `validateActivityNearbyInput` 严格校验查看点、半径、类型、行政区、游标和数量。
- 公共活动 DTO 只输出会合地点名称/地址等安全元数据；精确坐标不进入普通列表和详情；附近响应只增加服务端计算的 `nearby.distanceMeters`。

## 3. 实现 Cloud / Memory / Mock 附近查询

- 活动创建时保存发布者主动选择的公开会合地点；Cloud 额外物化 `meetingPoint.geoPoint`。
- 新增 Store `listNearbyActivities`：Cloud 使用 `geoNear`，Memory/Mock 使用同一半径、状态和 Haversine 排序语义。
- 新增公开只读 `activity.nearby`，查看者坐标仅在调用栈内使用，不写审计或持久化。
- 历史无坐标活动不进入附近结果，不做地址猜测回填。

## 4. 接入高德公开会合地点选点

- 扩展运行配置 `amapMiniProgramKey`，真实值只放 ignored `config/local.js`，示例使用占位符。
- 新增小型高德服务适配器，调用官方 Input Tips 接口，清洗为严格 POI DTO；Mock 模式提供受控澳门 POI 数据。
- 新建发布分包 `location-picker` 页面：关键词检索、加载/空态/错误态、原生地图预览、确认后通过 EventChannel 回填。
- 三类表单增加统一“公开会合地点（必填）”控件；任何相关地点文字被手动修改时清除已选坐标，提交必须重新选点。
- 草稿只保存公开会合地点 DTO，不保存查看者实时位置；旧草稿缺失时安全为空。

## 5. 新增附近页并重构首页入口

- 新建活动分包 `nearby` 页面，覆盖说明、定位中、有数据、空态、拒绝/失败、续页失败和服务不可用状态。
- 只有点击“开启附近定位”才调用 GCJ-02 定位；页面隐藏/卸载清除坐标并使旧响应失效。
- 半径和类型切换重新从首批查询，列表按 ID 去重，活动卡展示真实距离。
- “组队拼团”导航到全部活动页；“发现更多”导航到附近页；首页标题改为“正在组队 · 全城热拼”，其他首页结构不变。

## 6. 部署说明、验证与审查

- 更新后端/前端 spec、README 与部署清单，明确高德 Key、`restapi.amap.com` request 合法域名和 `activities.meetingPoint.geoPoint` 地理索引。
- 运行专项测试、完整 `npm run verify`、包体和静态路径检查。
- GPT 5.5 复审后端/隐私/索引/游标，网页版 Gemini 3.7 Flash 复审最终前端实现。
- 修复全部 Critical/Warning，写 `review.md`，归档任务，提交并推送 `origin/main`。
