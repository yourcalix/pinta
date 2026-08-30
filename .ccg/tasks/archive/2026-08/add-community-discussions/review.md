# 社区讨论功能审查记录

## GPT-5.5 后端审查

首轮指出 CloudBase 同时间戳分页可能漏项、Mock 数字游标与云端不一致、社区幂等键未绑定正文、联系方式规避测试不足。均已修复：

- Cloud 查询使用 `createdAt + _id` 复合边界。
- Mock 使用与服务端同格式的 base64url 复合游标。
- 社区发帖/回复幂等缓存及业务实体绑定 payload hash。
- 原文与去分隔符文本双重检查 URL、电话、微信、QQ 和邮箱。
- 新增社区限流、同 key 不同正文冲突、举报目标和 Cloud 查询静态契约测试。

复审结果：Critical 无；剩余裸状态常量与已删除父帖 replyCount 更新 Warning 已修复。Mock `viewerIsAuthor` 保留 persona，是因为真实云函数即使公开读取也会通过 `getWXContext().OPENID` 提供调用者身份，二者语义一致。

## 自动化结果

- 全量测试：227/227 通过。
- 社区专项与四 Tab 静态契约均已纳入全量测试。
- `npm run check`：通过。
- `git diff --check`：通过。

## Web Gemini 3.7 Flash 前端复审

结论：【可交付】；Critical 无。

- W-01 已由现有实现覆盖：详情回复 Input 已配置 `adjust-position="true"` 与 `cursor-spacing="120"`。
- W-02 已由现有实现覆盖：详情页根容器预留 `150rpx + env(safe-area-inset-bottom)`，大于固定回复栏所需空间。
- 发帖页已在卡片标题行实时展示剩余字数；未采纳将计数器绝对定位到 Textarea 右下角的 Info 建议，以避免与多行文字和大字号产生覆盖。
- 两张社区 Tab 素材已按同一可见主体裁切框输出为 96×96 PNG-32，激活/未激活切换无缩放跳动，单张约 10KB。

## CloudBase 部署结果

- 环境：`cloud1-d0giupmx3ce04ddd0`。
- `api` 云函数已部署并确认状态为 `Active`（Node.js 16.13，15 秒超时）。
- 已创建 `communityPosts`、`communityReplies`、`communityRateLimits` 三个集合。
- 三个集合的数据权限均为“小程序端所有用户不可读写”，仅通过云函数访问。
- `communityPosts` 已创建 `status ASC + createdAt DESC + _id DESC` 非唯一复合索引。
- `communityReplies` 已创建 `postId ASC + status ASC + createdAt ASC + _id ASC` 非唯一复合索引。

## 后续真机验证

- iOS/Android 回复软键盘推升、Safe Area 与四 Tab 图标基线仍需在实际发布预览包中走查；不阻断本次代码及云端交付。
