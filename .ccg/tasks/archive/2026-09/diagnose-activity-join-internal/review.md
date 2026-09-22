# 审查结果

## 结论

APPROVE。

## 根因

登录后的 `activity.detail` 会调用 `CloudStore.getViewerContext`。旧实现通过 `applications.where(...).orderBy(...)` 与 `members` 多字段查询识别申请人和成员；真实 CloudBase 缺少对应复合索引时会抛出 SDK 异常，并被安全错误出口统一映射为 `INTERNAL`，客户端因此显示“服务暂时不可用，请稍后再试”。Mock/Memory 不校验 CloudBase 索引，所以本地测试未暴露。

## 修复

- 申请和成员写入从 MVP 初始提交起就使用 `activityId + userId` 派生的确定性文档 ID；读取改为 `doc(id)` 精确直读。
- 对读出的 `activityId / applicantId / userId / status` 再次校验，不匹配时按无角色处理，不放宽权限。
- 保持 `owner > member > driver > applicant > guest` 的角色优先级不变。
- 更新真实 CloudBase 索引说明，删除这条关键身份路径不再需要的索引描述。

## 验证

- 专项测试强制让 `where()` 抛错，覆盖 `PENDING` 申请人、`ACTIVE` 成员、`LEFT` 成员与字段错配脏数据。
- `npm run verify`：604 项，603 通过，1 项既有跳过；项目结构检查通过。
- GPT-5.5 后端复审无 Critical；其旧 ID 风险经 Git 历史确认：申请与成员从 MVP 初始版本起即使用确定性 ID。字段错配测试已补齐。
