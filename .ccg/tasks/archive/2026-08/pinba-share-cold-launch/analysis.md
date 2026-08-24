# 分析记录：活动分享卡片与冷启动直达

## CCG 后端分析状态

- 已按当前 CCG 配置调用 GPT 5.5 architect。
- 外部通道在限定等待 90 秒内没有返回审查正文，已终止进程；不把无返回结果记为分析通过。

## 当前源码事实

- `App.onLaunch` 只有配置挂载，以及真实模式下同步调用 `wx.cloud.init`；不存在自动登录、异步用户恢复或会话刷新 Promise。
- `activity.detail` 是公开 action，游客和受限账号都允许读取脱敏详情；申请动作才调用 `userService.login`。
- 详情页在 `onLoad` 写入 `options.id`，在 `onShow` 读取该 ID；已有 `_loadSeq` 防止旧响应覆盖和页面卸载后写入。
- 当前缺少 ID 时 `onShow` 不加载，但 `loading` 会永久保持 `true`，冷启动无效参数需要显式进入 `NOT_FOUND` 安全状态。
- `resolveDetailError` 已封闭映射 `TAKEDOWN / TIMEOUT / NOT_FOUND / INTERNAL / UNKNOWN`，分享落地可以复用。
- 单页栈返回发现页已使用 `wx.switchTab`，无需新增返回栈推断。

## 主会话初步判断

1. 当前架构没有真实的异步全局初始化来源，不应只为满足旧路线文字引入空 readiness Promise；`App.onLaunch` 会先于页面生命周期执行，公开详情也不需要登录。
2. 分享路径应只由当前已加载活动 ID 生成，使用 `encodeURIComponent`，不得携带 viewerRole、申请状态、联系方式或来源用户信息。
3. 页面应在 `onLoad` 固化本次路由 ID；缺失 ID 立即写入安全 `NOT_FOUND`，有效 ID 继续由现有 `onShow` 加载和 `_loadSeq` 截断竞态。
4. 是否同时增加页面内分享按钮，需要网页版 Gemini 从信息层级、触控与可发现性角度给出唯一建议；右上角原生菜单至少由 `onShareAppMessage` 支持。
5. 自动化应直接调用页面生命周期和分享回调，覆盖 encoded path、无敏感字段、无 ID、热启动旧响应、游客不登录及 TAKEDOWN 复用。

## 网页版 Gemini 3.7 Flash 分析回传

- 明确结论：不需要全局 readiness Promise；当前没有异步用户恢复来源，公开详情也不依赖登录。
- Critical：缺失 ID 时永久骨架屏；需让加载流程显式进入 `NOT_FOUND`。
- Warning：`NOT_FOUND` 不应提供无意义重试；加载中、无活动或错误态分享应降级到发现页。
- 推荐同时保留微信右上角原生分享菜单，并在详情卡片内提供低层级 `open-type="share"` 入口。
- 分享成功态只携带公开标题和编码后的活动 ID；异常态使用通用标题与发现页路径。

## 综合校正

- 采用 Gemini 的信息层级与降级方案。
- `decodeURIComponent` 必须放入防御性解析函数；畸形编码不能同步抛出导致白屏。
- 分享按钮使用弹性换行布局和 `min-height: 88rpx`，不能在系统大字号下挤压标题。
