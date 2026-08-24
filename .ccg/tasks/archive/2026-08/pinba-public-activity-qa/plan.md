# 实施计划：活动详情公开问答区

## 1. 测试先行

- 新增后端问答契约测试：游客读取、DTO 脱敏、状态矩阵、内容拒绝、越权回答、幂等与并发二答。
- 新增 Mock 问答闭环和账号受限测试。
- 新增详情页问答局部加载、竞态、提交防重、失败保留输入、WXML 绑定与 88rpx/Safe Area 测试。

## 2. 后端底层与契约

- 在 constants/validation 中补充问答文本限制和输入校验。
- Memory Store 增加 `activityQuestions` map、最多 10 条游标列表、幂等提问和原子回答。
- Cloud Store 增加 `activityQuestions` 集合查询、幂等创建与 doc-only 回答事务。
- Service 增加公开 DTO、三个 action、权限状态矩阵、Moderation、审计和稳定 ID。

## 3. Mock 与客户端 Service

- Mock 增加演示问题、公开 DTO、安全文本策略、list/ask/answer、状态和权限校验。
- 客户端 API 写动作列表加入 ask/answer；Activity Service 暴露 qaList/askQuestion/answerQuestion。

## 4. 详情页交互

- 主详情成功后启动独立问答加载，使用 `_qaLoadSeq`；主详情失败/卸载时截断问答请求。
- 在核心业务动作之后、举报活动之前增加次级 qa-card，覆盖 loading/empty/error/ready、折叠 3 条和最多 10 条提示。
- 增加自定义底部输入抽屉，支持提问与发起者回答、字数、键盘避让、Safe Area、pending 防重和失败保留输入。
- 成功写入后关闭抽屉并静默刷新服务端事实；不做乐观插入。

## 5. 验证与交付

- 跑专项、全量测试、项目检查、diff 与敏感信息扫描。
- GPT 5.5 复审后端；网页版 Gemini 3.7 Flash 复审前端实现。
- 修复 Critical/Warning，更新 Spec/review，归档任务，提交并普通推送 `origin/main`。
