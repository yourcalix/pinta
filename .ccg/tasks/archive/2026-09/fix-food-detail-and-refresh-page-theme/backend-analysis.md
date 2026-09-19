# GPT-5.5 后端与隐私分析摘要

- 根因是详情地点行带箭头但未绑定点击事件，前端 JS 也没有查看地点动作。
- `publicActivity` 已安全公开 `meetingPoint.label/address`，足够完成文本查看弹层。
- 不需要修改或部署云函数；禁止新增公开经纬度、POI ID、adcode、provider、coordinateSystem 或 `meetingGeoPoint`。
- 不应调用 `wx.openLocation`，也不应把公开地址送入地理编码服务反查坐标。
- 历史活动应按 `meetingPoint -> sceneLine -> placeLabel -> 缺失提示` 顺序兼容。
- 全局暖米白迁移必须同时处理 JSON、WXSS、WXML，避免导航区、下拉区或图片解码前仍露出深蓝。
- 保留搭子星球暗夜主题与个人主页真实头像沉浸背景等语义例外。
