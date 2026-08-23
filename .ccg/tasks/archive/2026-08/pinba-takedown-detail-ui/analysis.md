# 前端分析结论

## Gemini 3.7 Flash 反馈

- 推荐 `errorCode` 与展示文案分离，不以字符串比对识别 `TAKEDOWN`。
- 每次加载前同时清空旧 `activity`、`detailRows`、错误码和错误文案。
- 使用 `_loadSeq` 仅允许最后一次请求更新页面，避免慢请求覆盖新结果。
- 复用 `empty-state`；下架状态提供“返回发现页”，通过 `wx.switchTab` 兼容冷启动单页栈。
- 下架分支不可重试；普通错误保留重新加载。

## 主会话综合调整

- 不使用“涉嫌违规”等未经接口确认的归因，采用中性文案“活动已被平台处理”。
- 不直接展示未知 SDK/CloudBase `error.message`，通过纯函数映射为安全文案。
- 无需新增 WXSS；现有 `empty-state` 已满足布局与触控区要求。
- `onUnload` 使请求序列失效，避免页面销毁后旧请求继续回写。
