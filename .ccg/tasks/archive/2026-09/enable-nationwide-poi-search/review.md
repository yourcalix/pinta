# 审查记录

## GPT 5.5 后端审查

初审无 Critical，提出三项 Warning：

1. 省直管市采用 `city === district`。该形态是当前产品契约的明确回退规则，用于确保 city/district 均可检索，因此保留并由专项测试覆盖。
2. 客户端行政区字段可能与活动顶层 city/district 混配。已修复：Cloud 与 Mock 均强制活动 city/district 和 meetingPoint 对应字段一致，不一致直接拒绝。
3. Mock 空 city 游标指纹使用 `undefined`，与正式端空字符串不同。已修复为 `query.city || ''` / `query.district || ''`。

同时补充公开 DTO 断言，确认 `province / adcode / poiId / latitude / longitude` 均不向公开活动接口透出。

复审发现创建接口仍可绕过前端、省略 `meetingPoint`。已修复：除 `benefit + ONLINE` 外，Cloud 与 Mock 的新活动创建均强制要求完整高德会合地点；历史无地点活动只在读取路径兼容。附近定位坐标越界错误的字段上下文也由 `meetingPoint` 修正为 `location`。

最终复审无 Critical，结论为 **APPROVE**。复审提出的线上拼享惠旧客户端残留坏地点 Warning 亦已修复：Cloud 与 Mock 均先识别 `ONLINE`，再忽略残留 `meetingPoint`，不让无关旧字段阻断线上优惠发布。

## Web Gemini 3.7 Flash 前端审查

用户已粘贴真实审查结果，结论为 **APPROVE**，无 Critical、Warning。

审查确认：

1. 选点页“城市 · 区县”结构能避免直辖市重复，并覆盖普通省市、特别行政区与省直管地区。
2. 旧草稿缺行政区时强制重新选点，避免全国化后继续产生脏数据。
3. 线上拼享惠隐藏地点并提交“全国 / 线上”，不携带 `meetingPoint`；线下模式恢复必选地点。
4. 精确坐标、`poiId`、`adcode` 不进入公开页面或公开 DTO。
5. 320px、小屏与系统大字由可换行行政标签、弹性卡片和既有触控热区防护覆盖。
