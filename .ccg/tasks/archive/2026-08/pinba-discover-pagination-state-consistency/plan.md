# 实施计划

## 1. 测试先行

- 增加游标解析、稀疏 keyword、到期归一化和末页游标的后端失败测试。
- 增加 Mock 两页续拉、畸形游标和 list/detail 过期一致性测试。
- 增加发现页 replace/append、抢占、去重、续页失败、计时护栏和卸载截断测试。

## 2. 后端分页与状态底层

- 新增共享的安全游标解析与读时活动状态归一化纯函数。
- Memory Store 改为基础候选集 raw-offset 扫描，不在读列表时修改实体。
- Cloud Store 分批扫描 keyword/到期过滤，填满页面或返回可继续的原始偏移游标。
- 详情接口使用同一到期归一化，保证已截止招募活动对外为 `EXPIRED`。

## 3. Mock 契约对齐

- Mock 校验 cursor/limit，按 raw offset 返回 10 条分页和 nextCursor。
- Mock list/detail 使用读时归一化，不污染持久化演示状态。

## 4. 发现页状态机

- 用统一 `fetchActivities` 支持 replace/append，按查询序号丢弃旧响应并按 ID 去重。
- 切分类、搜索、下拉刷新、页面返回和到期刷新执行 replace；触底与页尾重试执行 append。
- 增加互斥页尾状态、一次性安全补拉、最近截止计时和页面显隐清理。

## 5. 验证与交付

- 跑专项、全量测试、语法/结构、diff 与敏感信息检查。
- GPT 5.5 复审后端分页和到期契约；网页版 Gemini 复审前端实现。
- 修复 Critical/Warning，更新 Spec 与 review.md，归档、提交并推送本阶段到 `origin/main`。
