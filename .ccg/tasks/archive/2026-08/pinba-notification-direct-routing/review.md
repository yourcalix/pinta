# G3 通知受控直达审查

## 实现结论

- 后端通知类型稳定映射为 `MANAGE | GROUP | DETAIL`，公开 DTO 与 Mock 都使用显式字段白名单。
- 客户端只从本地白名单生成活动路径；未知目标降级详情，缺失 ID 返回发现页，活动 ID 按不透明字符串编码。
- “我的”通知点击在普通已读失败时保持可达，在 `ACCOUNT_DISABLED` 已统一处理时停止导航。
- manage/group 支持缺失或畸形 ID、无权限、下架、超时和单页面栈错误操作，并通过 `_loadSeq` 截断过期响应。
- group 只允许 `FORMED | IN_PROGRESS | COMPLETED`，旧成团通知遇到已回退招募状态时转回详情，不展示虚假成团状态。

## CCG 分域复审

### 网页版 Gemini 3.7 Flash

- 最终结论：【可交付】。
- Critical 无，Warning 无。
- Info 建议通知标题补 `min-width: 0` 与连续字符折行；已落实并增加静态回归测试。

### GPT 5.5

- 两次跨页面全量审查在 120 秒内无正文，均已终止并如实记录。
- 聚焦后端契约审查指出 Mock 展开字段可能透传未来 `url/page`；已改为显式白名单，并加入恶意种子字段不泄露测试。
- 修复后复核：Critical 无、Warning 无；确认真实后端与 Mock DTO 对齐，未知类型和特殊 ID 编码测试完整。

## 验证

- `node --test tests/notification-routing.test.js tests/notification-target-pages.test.js`：10/10 通过。
- `npm run verify`：77/77 测试通过；33 个 JSON、51 个 JavaScript、13 个 WXML 项目检查通过。
- `git diff --check`：通过。
- npm 仅提示本机 npm 11 与 Node 18 的版本支持告警，不影响测试结果。

## 仍需真机确认

- iOS 服务通知冷启动单页面栈下的 `redirectTo` 与 VoiceOver 朗读。
- Android 特大字号下通知动作排布，以及全面屏手势区的错误按钮避让。
- 真实订阅模板尚未配置，本阶段只交付可复用的安全 `page` 构造契约，不发送真实服务通知。

## 最终结论

【可交付】
