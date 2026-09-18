# GPT 5.5 后端 / 数据契约分析

## 结论

- 不能只移除前端澳门过滤。当前发布表单、Cloud 与 Mock 会合地点校验、活动行政区字段和 nearby 查询都依赖澳门试点契约。
- 如果只开放搜索，外地 POI 会在发布时被拒绝；如果只放开坐标校验，活动仍会被错误标记为澳门，污染列表与附近查询。
- 若产品目标是全国地点可选并可发布，必须同步升级 POI DTO、发布 payload、Cloud/Mock 校验和 nearby 城市语义。

## 最小安全范围

1. `amap.js` 移除 `city=澳门`、`citylimit=true`、澳门行政区与澳门矩形过滤。
2. 标准化高德 `pname/cityname/adname/adcode` 为受控的 `province/city/district/adcode`。
3. 发布表单不得再硬编码澳门；活动 `city/district` 必须与选择的结构化 POI 一致。
4. Cloud 与 Mock 将 `macauCoordinate` 拆分为全国 GCJ-02 基础坐标校验，并保持同构。
5. nearby 查看者坐标支持全国；城市筛选变为可选，游标继续绑定实际筛选条件。
6. Cloud/Memory/Mock nearby 仅在明确传入 city 时按城市过滤。
7. 公开 DTO 继续只返回地点名称与地址，不公开经纬度、adcode、poiId。

## 风险

- 客户端行政字段并非强信任事实；服务端必须做长度、格式、坐标与字段一致性防御。若要求强权威，需要后续增加服务端 AMap 二次验证。
- 全国经纬度粗边界只能用于格式防错，不能声称为精确国界判断。
- 旧 nearby 游标可能需要版本升级或安全失效后重拉第一页。
- Mock 与 Cloud 重复校验必须有同名测试防止漂移。

## 关键文件

- `miniprogram/services/amap.js`
- `miniprogram/subpackages/publish/form/index.js`
- `cloudfunctions/api/lib/activity-location.js`
- `cloudfunctions/api/lib/validation.js`
- `cloudfunctions/api/lib/cloud-store.js`
- `cloudfunctions/api/lib/memory-store.js`
- `miniprogram/mocks/server.js`
- `tests/amap-nearby-ui.test.js`
- `tests/activity-nearby.test.js`
- 发布表单相关测试
