# 复审记录（进行中）

## 后端：真实 GPT-5.5

### 第一轮

- 模型路由：`codeagent-wrapper --backend gpt55 --gpt-model gpt-5.5`
- Session：`01a06cfb-3a97-7a10-ad1f-41984d94898b`
- 结论：无 Critical；1 个 Warning。
- Warning：`SUSPENDED` 的 `OWNER_CONSULT` 已在列表、消息历史和发送链路 fail-closed，但 `dm.conversation.read` 尚可返回会话 DTO 并条件清零未读。

### 修复

- Memory Store 在 `markDirectConversationRead` 的任何返回/写入前检查咨询来源活动；缺失拒绝，下架返回 `TAKEDOWN`。
- Cloud Store 在同一事务内读取会话与来源活动并完成同样检查，之后才允许条件已读写入。
- Mock 同步真实契约。
- Memory/service、Cloud 事务和 Mock 回归均断言：下架咨询已读失败，`unreadByUser` 与 `readAtByUser` 不变。

### 第二轮复核

- 模型路由：新的真实 GPT-5.5 会话，fallback 显式设为同一 `gpt-5.5`，未使用替代模型结果。
- Session：`01a06cff-63e2-73e1-ba8b-89a34cb4f486`
- Critical：无。
- Warning：无；原 Warning 已关闭。
- 结论：**后端可交付，待真实 CloudBase 索引、迁移与事务联调。**

## 本地验证

- `npm run verify`：228 pass，1 个既有 skip，0 fail。
- `scripts/check-project.js`：status `ok`。
- 修改及新增 JavaScript 文件逐项 `node --check` 通过。
- `git diff --check` 通过。

## 前端：网页版 Gemini 3.7 Flash

用户已贴回真实复审结果：无 Critical，3 个 Warning，结论为“本地可交付，待真机验证”。

### Warning 与处理

1. 600×750 插画在长屏 `aspectFill` 下会横向裁掉约 26%：已改为 `aspectFit`，由各活动类型的海报底色承接空余区域，完整保留人物和器材。
2. 三枚工具按钮的 82rpx 视觉宽度不足 44px 热区：已将实际 `flex-basis/min-width/min-height` 固定为 88rpx，并保持视觉内容紧凑。
3. 320px 下主胶囊长状态文案可能换行或裁切：增加独立 `.primary-label` 单行省略，并在 340px 断点将字号降至 24rpx。

相关静态契约测试已更新，全量 `npm run verify` 再次通过。Gemini 标注的海报裁切、导航切换帧率及 iOS/Android 键盘顶升仍属于真机验证边界，不冒充已验证。
