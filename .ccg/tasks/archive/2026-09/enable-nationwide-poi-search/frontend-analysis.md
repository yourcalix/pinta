# Web Gemini 3.7 Flash 前端分析摘要

## 结论

- 全国 POI 搜索、全国发布与全国附近查询必须同批上线，不能保留澳门发布校验。
- 高德 Input Tips 与 Place Text Search 均应移除 `city: '澳门'`、`citylimit: true`，不传城市时使用全国召回。
- 选点结果统一输出 `poiId / label / address / province / city / district / adcode / latitude / longitude / coordinateSystem / provider`。
- 搜索结果卡片必须明确显示省、市、区，降低全国同名地点误选概率；320px 下允许行政区与地址自然换行。
- 直辖市、特别行政区、省直管县级行政区必须有明确回退规则，不能依赖 `cityname` 永远存在。
- “附近拼吧”采用全国方案：按查看者真实坐标进行地理距离查询，不再附加澳门城市过滤。
- 公开活动 DTO 只保留地点名称与地址，不暴露坐标、POI ID、adcode 或内部 provider 信息。

## 风险边界

- 仅前端解锁全国会造成外地地点选中后发布失败，属于前后端契约脱节。
- 全国重名 POI 必须通过行政区展示降低误选。
- 客户端行政区字段只能作为受控提示，服务端仍需做白名单、长度、坐标系统和全国粗范围校验。
- 全国粗范围用于拒绝明显非法坐标，不应被表述为精确国界判断。

## 验收重点

- 北京、上海、广州、湖北仙桃、澳门地点均可搜索、选择、发布。
- Input Tips 有坐标时只发一次请求；无坐标时才调用 Place Text Search。
- 全国附近查询不传 city 时仍可返回半径内活动。
- 全国地点发布后，活动主表 city/district 与 meetingPoint 一致。
- 搜索结果展示行政区；公开详情不泄露精确定位字段。
