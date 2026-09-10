# Analysis

## 复杂度与风险

- 复杂度：L+。涉及首页信息架构、发布表单、地图选点、运行配置、活动创建与公开 DTO、Cloud/Memory/Mock 存储、附近查询、分页和部署索引。
- 风险：高。新增位置权限和公开会合地点坐标，必须区分发布者主动公开的活动地点与查看者临时定位，并防止精确位置进入日志、用户资料或无关 DTO。

## 当前事实

- 首页“组队拼团”只滚动到首页活动区；“发现更多”进入现有 `/subpackages/activity/list/index` 全部活动页。
- 首页和全部活动页均调用 `activity.list`，当前只按城市、行政区、类型、关键词和时间过滤，不具备地理距离能力。
- 发布表单仅拼饭桌提供 `wx.chooseLocation`，且当前只保留地点名称，丢弃经纬度；拼同行与拼运动没有坐标选点闭环。
- `activity.create`、活动存储实体和公共 DTO 均无坐标字段；后端规范仍明确写着 MVP 不保存经纬度。
- CloudBase 官方支持 `GeoPoint` 与 `geoNear`，但必须为地理字段建立地理位置索引。
- 高德微信小程序 SDK 需要高德 Key，并要求把 `https://restapi.amap.com` 配为微信 request 合法域名；SDK 提供 `getPoiAround`、`getRegeo` 和 `getInputtips`。

## GPT 5.5 架构结论

- Verdict：`APPROVE_PLAN`，无必须先询问用户的阻塞性产品问题。
- 首页“组队拼团”应直接进入现有全部活动页；“发现更多”应进入新增附近活动页，不要把 `activity.list` 偷换成位置查询。
- 新增 `activity.nearby`：查看者坐标只作为单次请求参数，服务端执行半径过滤和距离排序；不得保存、审计或记录查看者坐标。
- 高德负责公开会合地点的 POI 搜索、选点和逆地理编码；拼吧自己的活动数据仍由 CloudBase 查询，不用高德周边 POI API冒充应用帖子。
- 新活动保存发布者主动选择的公开 `meetingPoint`，坐标系统固定 `GCJ02`；Cloud 使用 GeoPoint，Memory/Mock 用 Haversine 保持契约一致。
- 历史无坐标活动继续存在于全部活动、详情和个人记录，但不得伪造坐标或进入附近结果。
- CloudBase 必须先部署 `activities.meetingPoint.geoPoint` 地理索引，再开放正式附近入口。

## 推荐产品解释

1. 首页不在首屏索取位置权限；现有三张活动预览继续作为不带位置权限的全城“正在组队”预览，避免把未过滤内容称为“附近”。
2. 点击“发现更多”进入新的“附近拼吧”页；页面在明确说明用途后由用户主动启用定位，拒绝时提供“查看全部活动”降级入口。
3. 点击“组队拼团”直接进入现有全部活动页，保留关键词、类型筛选和完整游标分页。
4. 发布时三类活动都必须选择一个公开会合地点：同行取出发集合点，运动取场馆，饭桌取餐厅；会合地点与用户实时位置明确分离。
5. 初版附近页优先采用“距离排序列表 + 距离标签”，不公开活动精确坐标；高德地图用于发布选点。若产品明确要求地图标记视图，再单独允许 `activity.nearby` 返回选定公共场所坐标。
6. 默认半径建议 3km，可切换 1km / 3km / 5km / 10km；服务端上限 10km。

## 官方依据

- 高德微信小程序入门：需申请 Key、引入 `amap-wx.js`、配置 `https://restapi.amap.com` 合法域名：https://lbs.amap.com/api/wx/gettingstarted
- 高德 SDK 方法：`getPoiAround`、`getRegeo`、`getInputtips`：https://lbs.amap.com/api/wx/reference/core
- CloudBase GeoPoint/geoNear：https://docs.cloudbase.net/database/data-type
- CloudBase 地理位置索引要求：https://cloud.tencent.com/document/product/876/19371
