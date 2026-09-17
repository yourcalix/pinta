# 附近拼吧加载失败修复计划

1. 先补充前端错误映射、有效坐标重试和保留旧列表测试。
2. 补充 Cloud 地理索引错误多形态归一测试及未知异常负例。
3. 实现 `resolveNearbyError`、`canRetryNearby` 与 `handleRetryNearby`，筛选失败时保留已有内容。
4. 实现后端窄范围地理查询错误识别，不吞掉权限、网络和未知数据库异常。
5. 运行专项与全量校验，并复审差异。
6. 提供真实 CloudBase `activities.meetingGeoPoint` 地理位置索引与云函数部署验收步骤。
