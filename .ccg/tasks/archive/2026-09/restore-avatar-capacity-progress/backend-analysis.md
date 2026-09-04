# GPT 5.5 后端分析摘要

## 推荐方案

将现有 `avatarRoster` 从旧拼车专用快照扩展到 `companion / sport / food` 三类活动。私有存储继续使用 `{ memberId, avatarKind }` 去重，公开 DTO 只输出受控的 `avatarSlots: [{ kind }]`，绝不返回成员标识。

## 核心生命周期

- 创建：owner member 与 activity roster 同时写入真实 `avatarKind`。
- 批准：申请、member、memberCount 与 roster 在同一原子边界更新。
- 退出：memberCount 与 roster 同时移除对应 member。
- 资料更新：同步用户所有有效活动的 member.avatarKind 与 roster。
- 历史缺失 roster：输出全 `EMPTY` 槽位并保留真实数字进度，禁止按人数伪造头像类型。

## 关键风险

- Critical：公开误传 `avatarRoster/memberId/userId`；必须使用白名单 DTO 与隐私测试。
- Critical：Mock、Memory、Cloud 生命周期维护分叉；必须分别测试 create/approve/leave/profile。
- Critical：按 memberCount 伪造头像；缺失 roster 只能空槽降级。
- Warning：现有工具固定最多 7 个槽位，需要与活动容量规则对齐并设置硬上限。

## 前端要求

发现卡消费服务端 `avatarSlots`，恢复头像槽位和明确的 `memberCount/maxMembers` 进度；撤销上一提交中仅针对数字与箭头的入场动画。
