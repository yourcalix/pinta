# Gemini Web 前端审查提示词

ROLE: frontend reviewer

请审查一个微信小程序的首页、发现页和自定义 TabBar 重构。参考图是 Concept A 暖米白生活方式首页：顶部轻量问候、柔和大 Hero、三张彩色快捷卡、下方内容流，以及悬浮白色胶囊 TabBar（首页 / 发现 / 中央黑色发布加号 / 消息 / 我的，选中项带黄色小圆点）。

本次实现要点：

- 保留物理路由：`pages/discover/index` 现在显示为“首页”；`pages/community/index` 现在显示为“发现”。
- 首页背景改为 `#F9F7F2`，包含问候栏、340rpx Hero、三张快捷卡、搜索和四类筛选、每页五条真实活动卡、静态“成团记忆”预告条。
- 发现页背景同为 `#F9F7F2`，包含 PINBA DISCOVER 标题、发帖按钮、发现守则、真实帖子流；未伪造图片、天气、围观量或虚假分类。
- TabBar 为左右 24rpx、底部安全区上方 24rpx 的白色悬浮胶囊，高 116rpx；中央发布为黑色圆形加号，普通入口为 CSS 单色图标，激活态为黑色并带黄色小圆点。
- 所有核心按钮和筛选项最小触控高度为 88rpx。
- 375/430px 与 320px 开发者工具画面均已检查：无溢出、无重叠、TabBar 可切换。
- 自动化结果：313 tests，312 pass、0 fail、1 historical skip；项目静态检查通过。

请重点审查这些文件：

- `miniprogram/app.json`
- `miniprogram/custom-tab-bar/index.js`
- `miniprogram/custom-tab-bar/index.wxml`
- `miniprogram/custom-tab-bar/index.wxss`
- `miniprogram/pages/discover/index.js`
- `miniprogram/pages/discover/index.wxml`
- `miniprogram/pages/discover/index.wxss`
- `miniprogram/pages/community/index.js`
- `miniprogram/pages/community/index.wxml`
- `miniprogram/pages/community/index.wxss`
- `miniprogram/components/activity-card/index.wxss`

请特别检查：

1. 与参考图的整体构图、米白配色、留白、圆角、阴影和悬浮 TabBar 是否协调。
2. 375px 与 320px 下问候栏、Hero、三快捷卡、搜索筛选、活动卡和发现帖子是否有挤压或遮挡风险。
3. 中央发布按钮、普通 Tab 图标、黄色激活点是否清晰且不会与安全区冲突。
4. WXML/WXSS 是否使用微信小程序不稳定或不兼容的写法。
5. 无障碍、触控热区、长文本、大字体与 reduced-motion 是否存在遗漏。
6. 是否保留了真实数据契约，没有通过 UI 重构引入假内容或死胡同交互。

OUTPUT：

- 先给总体判断和最主要问题。
- 然后按 Critical / Warning / Info 分级列出问题。
- 每个问题注明具体文件或区域、触发条件、用户影响、最小修复建议。
- 明确区分“可由代码证实”和“必须真机验证”的结论。
- 最后给出“可以交付 / 修复后交付 / 不可交付”的结论。
