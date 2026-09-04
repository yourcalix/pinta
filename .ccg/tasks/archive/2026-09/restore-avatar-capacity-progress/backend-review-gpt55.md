# GPT-5.5 真实后端复审

模型：gpt-5.5。SESSION_ID：01a06c8e-f78e-7d30-83fa-ef710d0b53cb。
本次网络权限获批后通过指定 CCG wrapper 成功取得报告，exit code 0；未使用其他模型或本地 fallback。以下为报告内容的忠实整理，非修复完成声明。

## Critical

无。

## Warning

1. service.js publicActivity 优先取 maxMembers，旧 ride 数据如果同时携带 maxMembers:20，normalizeRideCapacity 设置的 maxPassengers:7 无法覆盖它。新增 avatarSlots 因而可能输出20槽，与 rideCapacity 固定7人的规则不一致。建议 ride DTO 使用归一化容量。
2. Mock 审批仍按 ride 固定7人，而公开槽位支持20人。报告提出“Mock 创建 type:ride,maxMembers:20”的复现条件，建议统一旧 ride 容量。主会话核对备注：当前 createActivity 明确只接受 companion/sport/food，因此该创建复现条件不成立；应限定为历史/注入数据兼容风险，不能将其报告成新活动创建漏洞。
3. CloudStore.syncUserAvatarKind 的事务只更新活动 avatarRoster，没有更新 updatedAt，而 MemoryStore/Mock 会更新活动时间。建议同一事务更新 updatedAt；报告中依赖 updatedAt 的缓存/增量同步场景是条件性风险，尚未证明当前客户端有该依赖。

## Info

- 20人上限在生产、Mock、前端分别定义，建议同名常量或共享边界测试。
- 新增生命周期断言主要覆盖 MemoryStore，建议补 CloudStore 事务测试：批准写入头像、退出移除、资料同步更新活动时间、缺失用户文档。

## 模型交付结论

请求修改。核心恢复方向正确，公开 DTO 没有泄露 memberId；MemoryStore 主路径有覆盖。修正容量一致性和云端同步元数据后再验收。

## 后续

逐项验证并修正成立的问题，补测试后再次通过 GPT-5.5 复审。尚未修改业务代码、归档、推送或部署。
