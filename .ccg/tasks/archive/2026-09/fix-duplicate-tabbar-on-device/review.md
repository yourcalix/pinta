# 审查结果

## 根因

发现页启动蒙层在 `tabBar.custom: true` 模式下调用了 `wx.hideTabBar()` 与 `wx.showTabBar()`。部分微信真机会因此重新唤醒原生 TabBar，而自定义组件仍在渲染，最终形成双层底栏。

## 修复

- 自定义 TabBar 新增内部 `hidden` 状态与 `setHidden()` 方法。
- 使用 CSS `display: none !important` 临时隐藏组件，保留选中态与未读数。
- 发现页启动流程只通过 `getTabBar()` 控制自定义组件。
- 物理移除业务代码中的原生 TabBar 显隐 API。
- 正常完成、超时、资源失败、页面隐藏与页面卸载均恢复自定义 TabBar。

## 验证

- 启动流程定向测试：10/10 通过。
- 自定义 TabBar 测试：6/6 通过。
- 全量测试：146 项，144 通过，2 项历史用例按预期跳过，0 失败。
- 项目静态检查：通过。
- `git diff --check`：通过。
- 网页版 Gemini 3.7 Flash 终审：Critical 0、Warning 0，结论可交付。

## 后续真机检查

重新上传预览包后首次冷启动发现页，确认底部只出现一套奶油白自定义 TabBar。
