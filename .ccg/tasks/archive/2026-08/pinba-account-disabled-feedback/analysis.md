# 分析记录

## CCG 后端分析状态

- 已按配置调用 GPT 5.5 architect，外部通道在限定等待时间内未返回正文并被终止。
- 实现完成后再次按配置调用 GPT 5.5 reviewer；限定等待 90 秒仍未返回正文，已终止进程。该项仅记录为“外部审查未完成”，不记为通过。
- 未把无返回结果伪记为审查通过；后端/会话边界依据现有 Spec 和源码继续分析。

## 当前代码证据

- `api.invoke` 是所有 Mock/CloudBase 请求的唯一出口，最适合保证受限账号错误不被页面遗漏。
- 页面目前分别使用 Toast、内联 `error`、`errorMessage` 或空 catch；若请求层直接显示 Modal 而页面不识别已处理标记，会出现双重反馈。
- `authenticatedActorScope` 仅存在于 `services/api.js`；收到受限错误后应在该层清空。
- `globalData.user` 由 `user.login` 写入，受限后需要同步置空。
- 写操作收到业务响应时，当前请求的 pending 幂等键已由现有 catch 清理；其他结果未知的 pending 键应保留，避免账号恢复后换键导致重复业务写入。
- 举报页在资料不完整时从 `try` 内跳转但没有 `finally`，`submitting` 可能在返回页面后保持为 `true`，实施时应一并收敛。

## 推荐架构候选

1. 新建可注入平台对象的单例反馈服务，负责 Modal 去重与确认后 `switchTab`。
2. `api.invoke` 识别 `ACCOUNT_DISABLED`，清空 actor scope 和全局用户，调用反馈服务，并给错误标记 `handled=true` 后继续抛出。
3. 页面 catch 不吞错：仍让 `finally` 恢复 pending；若 `handled` 为真则不再 Toast 或展示原始错误。
4. 数据加载页在统一 Modal 后只设置安全占位状态，避免 `user === null` 时进入正常内容分支。
5. 游客列表和详情不受影响；Mock 受限 persona 仅用于自动化，不加入正式演示身份入口。
