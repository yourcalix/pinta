# GPT 5.5 诊断摘要

- 最可能根因是前端本地状态竞态，不涉及后端/API。
- 选点回调同一次写入 `form.meetingPoint` 与 `form.originLabel`。
- 拼同行的 `originLabel` 为原生 input；页面恢复或 value 同步产生的迟到同值 `bindinput` 会被 `handleInput` 当作手动修改，无条件清空刚写入的 `meetingPoint`。
- 草稿保存会把竞态后的空值固化，但不是首因。
- EventChannel 用法本身符合微信模式，丢事件或 POI 非法的概率较低。

## 建议

- 仅当关联文本的新值与当前 `meetingPoint.label` 不一致时清空坐标。
- 同值迟到 input 保留地点；用户真实修改为不同文本仍清除地点。
- 同时覆盖 sport/food 的 `venue`，避免同类竞态。
- 补齐 EventChannel、迟到 input、真实编辑、草稿恢复测试。
