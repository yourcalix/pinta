# GPT 5.5 后端诊断

## 结论

- 截图表明定位已经完成，失败点是 `activity.nearby` 的真实 Cloud 查询。
- 最可能根因是 `activities.meetingGeoPoint` 未建立“地理位置索引”，或者索引建在错误集合、错误字段、错误类型。
- 社区动态的普通复合索引不能替代 `activities.meetingGeoPoint` 地理位置索引。
- 当前 CloudStore 只用 `/index|索引|geo/i` 识别地理查询故障；真实 CloudBase 错误形态可能未命中，最终变成 `INTERNAL`。
- 当前前端把所有非 `NEARBY_UNAVAILABLE` 异常都显示为“请检查网络”，因此索引、查询计划和旧云函数也会被误报为网络故障。

## 修复方向

1. 先从云函数日志或同等查询确认真实错误码和错误文案。
2. 确认 `activities` 集合顶层 `meetingGeoPoint` 为 GeoPoint，并建立地理位置索引。
3. 扩充后端对明确索引/地理查询规划错误的安全归类，但不得把权限、网络或未知故障都吞成 `NEARBY_UNAVAILABLE`。
4. 前端区分定位拒绝、网络超时、附近服务不可用与通用服务异常，不再把所有错误都说成网络问题。
5. 确认最新 `api` 云函数部署到小程序实际使用的 CloudBase 环境。

## 必测场景

- 无匹配活动返回空态，不报错。
- 历史活动缺少 `meetingGeoPoint` 时自然不进入附近结果。
- 缺地理索引时进入服务不可用态。
- TIMEOUT、传输失败和业务 INTERNAL 使用准确文案。
- 重试继续复用已取得的页面内临时坐标，不持久化位置。
