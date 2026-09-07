请把下面这段粘贴到网页版 Gemini 3.7 Flash；拿到结果后直接贴回 Codex：

<GEMINI_WEB_PROMPT>
ROLE: frontend UI/UX reviewer

PROJECT:
拼吧微信小程序，当前首页采用 Concept A 暖米白生活方式布局和悬浮胶囊 TabBar。

REVIEW TARGET:
审查本轮“记录已定稿成团记忆设计，并从当前首页移除该模块”的实现结果。

IMPLEMENTED CHANGES:
1. `pages/discover/index.wxml` 已彻底删除 `story-teaser`、`OUR STORIES`、成团记忆预告文案和装饰节点。
2. `pages/discover/index.wxss` 已删除全部 `story-*` 专属样式及 320px 覆盖；末页终点文案改为 `margin: 28rpx auto 16rpx`。
3. 首页根节点仍有 `padding-bottom: calc(200rpx + env(safe-area-inset-bottom))`，高于悬浮 TabBar 所需 180rpx。
4. 活动卡、每页 5 条游标分页、加载/空/错误态、搜索和筛选均未改动。
5. 新增 `.ccg/spec/frontend/archive/formed-memory-editorial-v1.md`，记录旧版定稿设计：347:430、694×860rpx、亮蓝背景、`OUR STORIES`、白黄倾斜艺术字、左 315×588rpx + 右双 315×286rpx 网格、320px 参数、空槽、无障碍及未来真实 UGC 数据边界。
6. `/assets/images/discover/formed-memory-editorial-bg.jpg` 原样保留，已验证为 694×860 Baseline JPEG。
7. 首页规范已改为活动流后直接由末页终点文案收口，并明确真实 UGC 上线前不挂载成团记忆。
8. 专项测试 11/11 通过；全量 `npm run verify` 为 313 tests、312 pass、0 fail、1 historical skip，工程检查 status ok。

KNOWN CONSTRAINTS:
- 不恢复成团记忆到当前首页。
- 不删除归档背景图或历史设计记录。
- 不修改后端 `activity.memories`，后端清理由未来独立任务处理。
- 不创建未来 UGC API 或虚假数据。

REVIEW QUESTIONS:
1. 首页删除是否彻底，分页器、终点文案和底部安全区衔接是否合理？
2. 设计档案是否足以让未来开发按原方案恢复，是否遗漏关键视觉/语义/交互约束？
3. 是否存在 Critical 或 Warning 级残留风险？

OUTPUT:
1. 总体判断
2. Critical / Warning / Info 分级问题
3. 每项问题的准确位置、触发条件、用户影响和最小修复建议
4. 已被代码与测试证实的结论
5. 必须真机验证的项目
6. 最终是否可以交付

Do not propose restoring the module to the current homepage. Do not invent future APIs or data.
</GEMINI_WEB_PROMPT>
