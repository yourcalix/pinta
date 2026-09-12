# Diagnostic Review

## Verdict

`CLOUD_CONFIGURATION_REQUIRED`

## Root cause

真实 CloudBase 环境缺少 `communityReplies` 详情查询所需的复合索引，是当前故障的最高概率且与错误表现完全一致的原因。详情接口读取帖子后会无条件查询回复；即使新帖没有回复，数据库仍须执行以下查询：

- 过滤：`postId`、`status`
- 排序：`createdAt` 升序、`_id` 升序

所需索引：`postId ASC + status ASC + createdAt ASC + _id ASC`。

发布成功说明 `communityPosts` 写入正常；错误不是 `NOT_FOUND` 文案，也排除了新帖 ID 丢失作为主要原因。

## Verification

- GPT-5.5 后端诊断确认索引缺失为高置信度根因。
- `node --test tests/community.test.js tests/social-interaction-loop.test.js`：19 pass、0 fail。
- 未修改任何页面、业务代码或视觉样式。

## User action

在 CloudBase 控制台为 `communityReplies` 新建上述非唯一复合索引，等待索引状态可用后重新加载原详情或发布新帖复测。
