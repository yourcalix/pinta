# GPT-5.5 后端契约分析摘要

## 可由现有事实安全推导

- `*_REGISTERED`：仅对 `viewerRole` 为 `owner/member` 或存在有效 `viewerMembership` 的当前用户成立。
- `*_TEAM_READY`：`FORMED / IN_PROGRESS / COMPLETED` 可证明活动曾达到成团阶段，但当前 DTO 在后续状态不稳定暴露 `formedAt`。
- `*_ACTIVE`：仅以 `status === IN_PROGRESS` 为权威依据；计划 `startsAt` 不等于真实开始。
- `*_FINISHED`：仅以 `status === COMPLETED` 为权威依据；详情 DTO 当前未暴露完成时间。

## 当前不能自动触发

- `SPORT_GEAR_READY`：装备说明文本不是装备确认事件。
- `MEAL_MENU_READY`：餐厅、菜系、预算等静态信息不是菜单确认事件。
- `SPORT_CHECKPOINT / MEAL_CHECKPOINT`：没有签到、线路完成、美食打卡或检查点事件。
- 稳定的攀岩 subtype：`sportType` 为自由文本，不得由前端猜测。

## 推荐契约

- `activity.detail` 顶层增加 ISO `serverNow`。
- 公开 Activity 增加可选、版本化 `progress`：`schemaVersion`、稳定 `sportSubtype`、带 `stage / occurredAt / source / revision` 的事件数组。
- 状态与事件矛盾时，以终止态和最新权威活动状态优先；seen/snooze 只控制提示，不改变事实阶段。

## 本地状态安全

- 不向页面 data、WXML、Storage key 或日志写入稳定用户 ID、openid、actorId、凭据或 `sessionScope` 原文。
- 可由 service 内部读取现有模块私有 actor scope，派生不可逆摘要键；页面只调用按 `activityId + stage + revision` 封装的查询、seen 与 snooze 方法。
- 阶段纠正需依赖 revision；没有 revision 时只能谨慎按当前权威阶段处理，不构造历史事件。

## 结论

- 一期可以先实现统一组件、详情页低优先级互斥调度、本地状态抽象以及四类权威通用阶段。
- 12 阶段全部自动触发不具备真实数据基础；四个事件型阶段与稳定运动子类型必须等待后端契约。
