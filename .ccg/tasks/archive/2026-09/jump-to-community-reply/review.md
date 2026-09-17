# 审查记录

## GPT 5.5 后端分析

- 现有正式与 Mock 讨论动态 DTO 已为 `POST_REPLIED`、`REPLY_LIKED` 返回 `replyId`，无需修改后端契约。
- 详情回复按 `createdAt + id` 正序并使用复合游标分页，前端可以在既有契约内有界续页定位。
- 建议只有定位成功或自然遍历后确认目标不存在时消费已读；网络失败和安全上限应保留未读。

## Web Gemini 3.7 Flash 前端终审

- Critical：无。
- Warning：无。
- 确认 `replyId` 路由、自动分页、DOM 锚点探测、导航避让滚动、背景色高亮与已读消费时序闭环正确。
- 确认 `_replyLocateSeq`、`_loadSeq`、`_disposed` 与 `_resumeDetailLoad` 能防御隐藏、卸载、旧响应晚到及首屏恢复竞态。
- 确认定位流程不修改 `replyTarget` 或 `_replyFocus`，不会拉起键盘或进入定向回复状态。
- Verdict：`APPROVE`。

## 主会话复核

- 自动定位最多 10 页或 200 条；超过上限停止自动请求，保留未读并允许手动续页。
- 回复自然删除或不可见时提示并受控消费，避免僵尸未读；弱网或续页失败保持未读。
- 页面隐藏会清理探测与高亮计时器、使旧加载序号失效；首屏在途切后台后返回会重新加载。
- WXML 使用数组索引生成安全 DOM ID，业务 `replyId` 不进入 CSS 选择器。
- 高亮仅改变背景色，不改变布局几何。

## 验证

- 定位及相关回归测试：33/33 通过。
- 全量 `npm run verify`：537 项测试，536 pass，1 个既有 skip，0 fail。
- 静态项目检查：通过（323 JSON、203 JS、28 WXML）。
- `git diff --check`：通过。
