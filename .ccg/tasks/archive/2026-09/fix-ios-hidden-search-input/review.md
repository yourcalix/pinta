# 审查结论

- 复杂度：S；风险：低；单个 WXML 真机兼容修复，由主会话审查。
- 真机搜索问题根因：搜索浮层仅使用 CSS 隐藏，iOS 原生 `input` 合成层可能继续显示 placeholder。
- 修复：浮层关闭时使用 `wx:if` 彻底卸载 `input`；打开时原有搜索、清空、确认和遮罩行为不变。
- 活动区与发布键重叠：用户提供的图 1 是上一轮相同的旧真机截图，其中活动卡处于误判的大字单列模式；该问题已由上一任务将阈值调整为 `fontSizeSetting >= 20` 解决。图 2 已显示目标三列布局，本轮不重复调整正确的 Hero 与卡片尺寸。
- 定向测试：18/18 通过。
- 全量校验：321 项中 320 pass、0 fail、1 historical skip；静态检查与 `git diff --check` 通过。
- Critical / Warning：无。

需要重新编译并生成新预览包，在 iPhone 13 mini 上确认关闭搜索时 placeholder 不再显示、活动区保持三列且位于 TabBar 上方。
