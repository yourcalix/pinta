# 修复与验证

- 根因：`app.json` 的 `tabBar.list` 即使启用 `custom-tab-bar`，其 `iconPath` 与 `selectedIconPath` 仍受单文件小于 40KB 的平台校验。
- 三张油画棒图标从 192×192 缩放为 128×128，保留 RGBA 透明通道与运行时视觉比例。
- 文件大小：发现 18,185B；社区 23,892B；我的 26,313B，全部低于 40KB。
- 新增自动化断言，校验三个被 `app.json` 引用的 PNG 均小于 `40 * 1024` 字节。
- TabBar 专项测试 6/6 通过；全量 144 项中 142 通过、2 项旧链路跳过、0 失败；静态检查与 `git diff --check` 通过。
