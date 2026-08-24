# CCG 复审：活动公开问答

## 前端：网页版 Gemini 3.7 Flash

- 结论：【可交付】。
- Critical：无。
- Warning：无。
- Info：建议在 `qa-modal` 根节点统一 `catchtouchmove="preventTouchMove"`，进一步阻止抽屉打开时的背景滚动穿透；已采纳并加入静态回归测试。
- 认可项：Q&A 信息层级次于申请/管理/成团主动作；独立 `_qaLoadSeq` 不影响主详情；Bottom Sheet、88rpx 热区、长文本折行、Safe Area 和提交失败保留输入符合当前 MVP 目标。
- 真机保留项：iOS 键盘推顶与 VoiceOver；Android 大字号、长文本和全面屏手势区。

## 后端：GPT 5.5 首轮

- 初始结论：【不可交付】。
- Critical：提问活动状态只在 Service 事务外检查，存在活动在预检后下架但问题仍写入的竞态。
- Warning：问答写入后审计失败可能导致客户端换新幂等键重试；Mock 的 ID/内容校验与真实服务存在错误码漂移。
- Info：状态矩阵和公开 DTO 联系方式隔离测试可进一步补齐。

## 已完成修复

- `createActivityQuestion` 的 Cloud/Memory 原子边界内读取活动并重验存在、下架、可提问状态和截止时间。
- 问题/回答与审计日志在同一 Store/CloudBase doc-only 事务内提交；同 hash 重试可安全复用。
- 客户端 mutating 请求收到 `INTERNAL` 响应时保留 pending 幂等键，成功和其他明确业务错误仍清除。
- Mock 补齐活动 ID、问题 ID、空内容和长度校验，统一返回 `VALIDATION_ERROR`。
- 补齐 DRAFT/FORMED/IN_PROGRESS/COMPLETED/CANCELLED/EXPIRED/SUSPENDED 状态矩阵、受限账号 answer replay、事务竞态、原子审计、DTO 联系方式隔离和 INTERNAL 同键重试测试。

## 最终验证

- 专项测试：27/27 通过；追加矩阵边界后 13/13 通过。
- 全量自动化：111/111 通过。
- 项目结构检查：通过。
- GPT 5.5 修复后复审：Critical 无、Warning 无，之前各项全部关闭，结论【可交付】。

## 最终结论

- GPT 5.5 后端复审：【可交付】。
- Web Gemini 3.7 Flash 前端复审：【可交付】。
- CCG 综合结论：【可交付】。
