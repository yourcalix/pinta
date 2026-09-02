# GPT-5.5 后端权限分析综合

## Critical

- 当前业务的 `activity.create`、`application.submit`、`activity.mine`、`group.space`、`group.contact.share/revoke`、`notification.list/read` 仍调用 `requireVerifiedStudent`，必须分别替换为合适的 `requireActiveUser`，但不得去掉登录、账号或成员权限门禁。
- `student.verification.get/submit`、`student.document.prepare/confirm` 与 `admin.studentVerification.review` 必须成为不可达的已下线动作；否则删除前端入口后仍可直接访问敏感链路。
- `studentVerificationSecrets` 历史集合可以保留，但应用运行时不得再读取、写入、生成上传地址或执行审核。

## Warning

- 必须同步清理真实 API、Mock、客户端 service、mutation/idempotency 集合和自动审核配置，避免不同环境契约分叉。
- `requireVerifiedStudent(context, true)` 原则上替换为 `requireActiveUser(context, true)`；原来只要求 `false` 的个人数据、通知和成员空间路径替换为 `requireActiveUser(context, false)`，不能机械取消鉴权。
- 前端删除学生认证入口后，“我的”页应直接并发读取个人活动和通知；请求序号与失败收尾仍需保留。

## 唯一推荐的旧客户端处理

- 将五个旧学生认证 action 加入服务端与 Mock 的 `REMOVED_ACTIONS`，统一返回明确的已下线错误，而不是落入未知 action。
- 理由：这是有意废弃的敏感能力，明确下线便于安全审计、日志和旧客户端排障，同时可以彻底删除 validation、store 和敏感资料实现。

## 测试门禁

- 无学生认证记录和历史已认证用户在活动权限上必须表现一致。
- 完整资料的活跃普通用户可以发布、加入、读取个人活动、通知和有效成员空间。
- 未登录、账号受限、基础资料不完整、容量/生命周期/成员权限、内容安全和幂等门禁保持原行为。
- 旧认证 action 明确下线且不读取/写入学生认证集合，不生成学生证上传地址。
- Mock 与真实服务行为一致，前端不再暴露或调用学生认证 service。
