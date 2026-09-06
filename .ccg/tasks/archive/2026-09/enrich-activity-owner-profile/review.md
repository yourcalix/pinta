# 审查记录

## GPT-5.5 后端复审

- 初审发现：CloudStore/MemoryStore 在历史重复 ACTIVE OWNER 数据下可能只检查首个 OWNER，未继续按 `activity.ownerId` 找到正确成员；旧缓存降级时可能缺失 `ownerProfile`。
- 已修复：有 `ownerId` 时在当前活动 OWNER 集合中精确匹配；仅在 `ownerId` 缺失时使用首个 OWNER。旧缓存现在始终生成白名单 `ownerProfile`。
- 复审结论：无 Critical；后端核心契约可交付。Mock 增补了显式 `activityId` 条件以保持语义清晰。
- 公开范围：`ownerProfile` 仅包含 `nickname` 与公开头像槽，不包含生日、MBTI、兴趣、成年确认、用户 ID 或原始 cloud fileID。

## Web Gemini 3.7 Flash 前端复审

- 结论：无 Critical，可以交付。
- 建议：加强右侧事实栏的长文本截断、手绘透明头像的圆形底色与边框、完整整卡读屏文本。
- 已处理：事实栏保持参考图的纵向标签/数值结构，并补 `min-width: 0` 与单行省略；头像改为 `#F3F4F6` 底色和 `#E5E7EB` 描边；无障碍文本补齐标题、角色、类型、规模和发布时间。
- 保留待真机验证：iOS/Android 字体基线、Host 标签垂直居中、极端长昵称省略后的左右留白。
