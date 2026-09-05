# 实施计划

1. 新增头像上传校验与图片检查工具，覆盖签发参数、文件签名、尺寸和私有 DTO 结构测试。
2. 在 MemoryStore / CloudStore 增加头像上传记录、检查、绑定与清除能力；CloudStore 对签发路径做精确归属校验并清理临时/旧文件。
3. 扩展 moderation 图片检查，并在云函数 config 中声明 `security.imgSecCheck` 权限；生产环境审核不可用时拒绝确认。
4. 在 service 增加 `profile.avatar.prepare / confirm / clear`，保持普通 `profile.update` 不接受头像输入且保留已有头像。
5. 在 Mock Server 实现同名合同；Mock 使用本地持久文件路径并显式返回 `mockOnly`。
6. 在客户端 service 编排 prepare、Cloud 上传与 confirm；页面不直接调用业务云函数。
7. 将个人资料头像区改为 chooseAvatar 交互行，增加上传中、失败重试、恢复默认、图片失败回退，并确保不重载表单草稿。
8. “我的”页优先使用本人自定义头像，失败回退性别头像；预览仅在存在兼容路径时开放。
9. 更新前后端 Spec，仅对本人头像开放受控 UGC 图片，不扩大到活动、社区、群聊或其他页面。
10. 运行完整测试与项目检查，按 CCG 路由完成 GPT-5.5 后端复审和网页版 Gemini 前端复审，修复问题后归档提交。
