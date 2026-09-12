# Requirements

## User correction

“发布讨论”页面背景必须与当前“发现”页面一致。

## Source of truth

- 背景色：`#F9F7F2`
- 页面与窗口背景均为暖米白纯色，不加载深蓝共享纸纹或遮罩。
- 状态栏、自定义导航标题和取消按钮使用适配浅色背景的深色文字。
- 保留发布讨论现有卡片布局、Image2 素材、话题交互、社区守则、提交逻辑和无 TabBar 子页面结构。
- 不修改“发现”页面，不修改全局 TabBar。

## Acceptance

- 发布讨论 WXML 不再包含 `shared-paper-bg.jpg`、`global-page-background` 或 `global-background-host`。
- WXSS 根背景为 `#F9F7F2`，导航和辅助文字具备浅色背景对比度。
- JSON 使用与发现页一致的背景色、深色下拉背景和黑色状态栏文字。
- 全局背景契约把发布讨论列入独立暖米白页面。
- 自动化测试与包体检查通过。
