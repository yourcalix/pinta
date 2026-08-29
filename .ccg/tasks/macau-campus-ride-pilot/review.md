# 澳门校园拼车试点 CCG 审查记录

## Web Gemini 3.7 Flash 前端审查

- 首轮指出司机 Bottom Sheet 读屏焦点穿透、320px 大字号双徽标挤压、发布人数边界联动三个问题。
- 已落实主内容动态 `aria-hidden`、徽标弹性换行与 `flex-shrink: 0`、最低/最大乘客数自动钳制。
- 用户贴回的复核结论为“调整后可交付”，相关前端专项测试已纳入全量测试。

## GPT-5.5 后端审查

- 多轮复审重点覆盖司机并发承接、申请/审批截止时间、容量双阈值、CloudBase doc-only 事务、事务后补偿、公开 DTO 脱敏、Mock 契约与 raw-cursor 分页。
- `rideFulfillments` 已确立为司机履约事实源；活动文档内的 fulfillment 仅作为缓存。详情、列表、我的、申请、审批与退团均从事实源水合或在事务内重验。
- Cloud `command.in` 已按 10 个 ID 分片；缺失 fulfillment 统一 fail-closed。
- 司机确认后禁止乘客自行退团，避免 `RECRUITING + ASSIGNED` 矛盾状态；司机列表使用独立可承接判定，满员但未承接的成团行程仍对司机可见。
- 最后一项 Cloud 司机列表接车窗口显式校验已补齐，与 Memory/Mock 保持一致。

## 验证

- `npm run verify`：153/153 通过。
- `node scripts/check-project.js`：44 个 JSON、65 个 JS、14 个 WXML，状态 `ok`。
- `git diff --check`：通过。
- 测试输出中的 `temporary audit failure` 与 privacy detached 日志为故障注入用例的预期日志，不代表失败。
- npm 对 Node 18 的版本提示为本机 npm 11 兼容性警告；项目代码与测试仍按 Node >=18 成功运行。

## 当前结论

代码审查与自动化门禁通过。进入 iPhone Mock 真机验收；真机通过前不归档、不提交为已完成阶段。
