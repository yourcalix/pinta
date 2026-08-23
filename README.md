# 拼吧 MVP

“拼吧”是一个微信原生小程序最小 MVP，帮助用户发起和参与拼车、拼商品、拼搭子活动。当前版本覆盖发布、发现、申请、审批、自动成团、成员联系方式解锁、完成/取消、站内通知与举报闭环。

本项目默认使用内置 Mock 服务，可直接以微信开发者工具游客模式运行，不需要 AppID、云环境或后端部署。CloudBase 云函数实现也已包含在仓库中，供下一阶段接入真实微信身份和数据库。

## 快速运行

1. 打开微信开发者工具，导入本仓库根目录。
2. 没有正式小程序 AppID 时选择游客模式；`project.config.json` 已使用 `touristappid`。
3. 点击“编译”。默认入口是“发现”页，能看到三条演示活动。
4. 在“我的”页可切换“发起者小拼”和“参与者阿同”，也可一键重置演示数据。

默认配置位于 `miniprogram/config/index.js`，其中 `useMock: true` 表示本地演示模式。

## 推荐验收路径

- 发起者闭环：我的 → 待处理申请 → 同意加入 → 自动成团 → 进入成团页 → 安全确认 → 查看联系方式。
- 参与者闭环：我的 → 切换为参与者“阿同” → 发现 → 打开“拼商品” → 提交申请 → 查看申请状态或撤回。
- 发布闭环：发布 → 选择一种拼法 → 完成两步表单 → 发布 → 在“我的发布”查看。
- 安全闭环：活动详情/成团页 → 举报 → 提交原因 → 该活动对举报者即时隐藏。

演示状态会保存在开发者工具本地缓存中。完成测试后可在“我的”页点击“重置”。

## 自动化验证

仓库根目录无需安装依赖，使用 Node.js 18 或更高版本运行：

```bash
npm test
npm run check
npm run verify
```

- `npm test`：业务服务与 Mock 闭环测试。
- `npm run check`：JSON、JavaScript 语法、WXML 约束和前端服务边界检查。
- `npm run verify`：依次执行全部检查。

## 切换到 CloudBase

在正式联调前完成以下步骤：

1. 将 `project.config.json` 的 `appid` 替换为真实小程序 AppID。
2. 在微信开发者工具中开通云开发环境，将环境 ID 写入 `miniprogram/config/index.js` 的 `cloudEnv`。
3. 创建集合：`users`、`activities`、`applications`、`members`、`notifications`、`reports`、`auditLogs`、`idempotency`。
   当前 MVP 使用确定性文档 ID 保障并发和幂等，正式环境应使用新建空库初始化，不要与采用随机成员/申请 ID 的旧版数据混用。
4. 将数据库集合权限设为“所有用户不可直接读写”，业务数据只允许通过 `cloudfunctions/api` 云函数访问。
5. 在 `cloudfunctions/api` 安装依赖并上传部署，云端安装即可：

   ```bash
   npm install
   ```

6. 云函数环境变量至少配置：

   - `PINBA_ENV=production`
   - `ENABLE_WECHAT_CONTENT_CHECK=true`

7. 将 `miniprogram/config/index.js` 中 `useMock` 改为 `false`。

生产环境如果没有启用微信内容安全检查，云函数会拒绝发布和用户生成内容提交，避免静默绕过审核。

## 建议数据库索引

- `activities`：`status + startsAt`、`type + status + startsAt`、`city + district + status + startsAt`、`ownerId + updatedAt`。
- `applications`：`activityId + createdAt`、`activityId + applicantId + status`。
- `members`：`activityId + userId + status`、`userId + role + status`。
- `notifications`：`userId + createdAt`。
- `reports`：`reporterId + targetType + targetId + status`。

## MVP 边界

- 不接平台支付，不做资金担保。
- 不提供车辆或司机，不承接运输服务。
- 不提供即时聊天；成团后才允许有效成员按需获取联系方式。
- 不公开手机号、二维码或微信 OpenID。
- 当前 Mock 数据只用于产品演示，正式运营还需完成真实账号、隐私政策、类目资质、内容安全和风控配置。

详细设计见 `outputs/拼吧-项目设计书-v1.0.md`，运行与验收记录见 `outputs/拼吧-MVP-运行与验收说明.md`。
