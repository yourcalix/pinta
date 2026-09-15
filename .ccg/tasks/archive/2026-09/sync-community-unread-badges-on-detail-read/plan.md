# 实施计划

1. 扩展社区动态校验与服务契约：新增只读 `community.activity.unread`，扩展 `community.activity.read` 的活动版本参数。
2. 在 MemoryStore、CloudStore 与 mock server 实现近 30 天未读汇总和版本条件已读；为 CloudBase 补充索引说明。
3. 更新小程序 service：提供未读汇总调用，并让 read 携带 `expectedUpdatedAt`。
4. 发现页在可见时刷新未读汇总并给铃铛叠加数字徽标，失败保留旧值。
5. 讨论动态页加载权威 Tab 未读数；点击卡片只导航并传活动上下文，不提前已读。
6. 详情页在首屏详情成功加载后消费来源动态，并守住重复加载、卸载与聚合版本竞态。
7. 补齐后端、mock、页面逻辑与静态 UI 测试，运行相关测试及全量测试。
8. 按 CCG 路由完成后端 GPT 5.5 与前端网页版 Gemini 审查，修复问题后更新 spec、归档任务并提交。
