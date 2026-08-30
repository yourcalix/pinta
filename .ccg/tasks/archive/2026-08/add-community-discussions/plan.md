# 社区讨论功能实施计划

## 目标与边界

新增四 Tab 中的“社区”公开文字讨论流，并提供发帖、详情、一层回复、作者软删除和举报闭环。MVP 不包含分类、搜索、点赞、私信、图片、附件、外链、楼中楼、通知或分享统计。

## 稳定 action 契约

- `community.post.list`：公开分页列表。
- `community.post.detail`：公开帖子详情及首/续页回复。
- `community.post.create`：登录且资料完整后发帖。
- `community.reply.create`：登录且资料完整后回复。
- `community.post.delete`：作者软删除帖子。
- `community.reply.delete`：作者软删除回复并原子扣减回复数。
- `report.create`：扩展 `COMMUNITY_POST | COMMUNITY_REPLY` 目标类型。

## 实施步骤

1. **领域与验证测试**
   - 新增社区服务测试，先覆盖公开读取、写入登录/资料门槛、DTO 脱敏、内容拒绝、幂等、稳定分页、软删除、回复计数和越权。
   - 新增前端静态/页面行为测试，覆盖四 Tab、社区页面层级、分页竞态、键盘与 Safe Area。

2. **后端纯逻辑与服务契约**
   - 增加社区文本规范化、链接/联系方式拦截、复合游标编码解码。
   - 扩展 validation、service action 集合、DTO mapper 和审计事件。
   - 保持 Moderation fail-closed，不记录正文。

3. **MemoryStore 与 CloudStore**
   - 新增 `communityPosts`、`communityReplies`、社区频率窗口状态。
   - 实现复合游标分页、事务回复计数、作者软删除和举报目标解析。
   - CloudBase 查询采用 `createdAt + _id` 稳定排序；事务只使用 doc 引用。

4. **客户端服务与 Mock**
   - 新增 `services/community.js` 并登记 mutating actions。
   - Mock 服务实现同样的公开读取、写入、软删除、回复计数和错误码。

5. **页面与导航**
   - `pages/community/index`：紧凑 Header、内嵌发帖入口、帖子列表、分页尾态。
   - `subpackages/community/compose/index`：500 字纯文字发帖，失败保留输入。
   - `subpackages/community/detail/index`：正文、回复分页、固定底部输入、删除/举报 ActionSheet。
   - `app.json` 更新为 `发现 / 社区 / 发布 / 我的`，分包注册 compose/detail。

6. **视觉资产**
   - 新增同几何母版 `tab-community-active.png` / `tab-community-inactive.png`，96×96 PNG-32。
   - 未获得最终素材前不得把临时占位图标标记为可交付。

7. **验证与复审**
   - 全量 `npm run verify`、`git diff --check`、主包预算和关键真机清单。
   - GPT-5.5 后端 reviewer 审查；网页版 Gemini 前端 reviewer 复审实际截图。
   - 修复 Critical 后归档、提交并推送 `origin/main`。

## 当前实施状态

- 后端、Mock、客户端服务、社区首页、发帖页、详情与回复页均已完成。
- 全量 223 项既有测试与 11 项社区专项测试通过，静态检查通过。
- GPT-5.5 复审的 Cloud 复合游标、Mock 游标、幂等 payload 绑定与联系方式规避问题已修复。
- 待办：导入社区 Tab 激活/未激活最终素材、开发者工具截图、网页版 Gemini 前端复审、部署与归档推送。
