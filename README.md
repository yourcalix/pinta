# 拼吧 MVP

“拼吧”是一个微信原生小程序最小 MVP，帮助用户发起和参与拼车、拼商品、拼搭子活动。当前版本覆盖发布、发现、申请、审批、自动成团、成员联系方式解锁、完成/取消、站内通知与举报闭环。

本项目默认使用内置 Mock 服务，可直接以微信开发者工具游客模式运行，不需要 AppID、云环境或后端部署。CloudBase 云函数实现也已包含在仓库中，供下一阶段接入真实微信身份和数据库。

## 快速运行

1. 打开微信开发者工具，导入本仓库根目录。
2. 没有正式小程序 AppID 时选择游客模式；`project.config.json` 已使用 `touristappid`。
3. 点击“编译”。默认入口是“发现”页，能看到三条演示活动。
4. 在“我的”页可切换“发起者小拼”和“参与者阿同”，也可一键重置演示数据。

默认配置位于 `miniprogram/config/index.js`，其中 `useMock: true` 表示本地演示模式。

## G0：真实 AppID 与隐私基线

仓库中的 `project.config.json` 始终保留 `touristappid`。接入真实账号时，不要修改并提交这个公共配置；微信开发者工具支持用优先级更高的 `project.private.config.json` 保存个人 AppID，且本仓库已经忽略该文件。

1. 复制 `project.private.config.example.json` 为 `project.private.config.json`，把占位值替换为真实 AppID；也可以在开发者工具“详情 → 基本信息”中修改，工具会优先写入私有配置。
2. 在小程序管理后台如实配置《小程序用户隐私保护指引》。当前代码实际调用的隐私接口只有 `wx.setClipboardData`，后台需声明剪贴板用途；不要勾选未使用的手机号、精确位置、头像、通讯录或相册能力。
3. 成团页只有在有效成员主动点击“复制联系信息”时才触发剪贴板隐私授权。拒绝只会中止复制，已通过服务端鉴权显示的联系方式仍可长按选择，其他功能不受影响。
4. 隐私弹窗提供“查看隐私保护指引”“暂不同意”和“同意并继续”；微信基础库低于 2.32.3 时不会使用新监听机制，复制 API 保持平台原生行为。
5. 真实 AppID 下必须用 iOS、Android 各至少一台设备验证同意、拒绝、10 秒内重试、协议打开和大字号布局。

完整后台与真机清单见 `outputs/拼吧-G0-账号合规与隐私验收清单.md`。

进入 G1 前运行只读门禁：

```bash
npm run g1:readiness
```

门禁返回 `0=PASS`、`3=MANUAL`、`1=BLOCKED`。它不会写入配置、登录微信账号或探测生产资源。先复制 `g1-readiness.manual.example.json` 为被 Git 忽略的 `g1-readiness.manual.json`，再根据后台与真机证据填写；完整操作见 `outputs/拼吧-G1-进入门禁与操作手册.md`。

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

1. 使用被 Git 忽略的 `project.private.config.json` 配置真实小程序 AppID，公共 `project.config.json` 继续保留 `touristappid`。
2. 在微信开发者工具中开通云开发环境。G1 联调时再通过不进入版本控制的本地配置或已选默认环境指定环境 ID；当前仓库中的 `cloudEnv` 保持空值。
3. 创建集合：`users`、`activities`、`applications`、`members`、`memberContacts`、`notifications`、`reports`、`auditLogs`、`idempotency`、`activityQuestions`、`rideFulfillments`、`drivers`、`vehicles`、`driverApplications`、`driverSecrets`、`driverDocumentUploads`、`communityPosts`、`communityReplies`、`communityLikes`、`communityRateLimits`、`directConversations`、`directMessages`。
   当前 MVP 使用确定性文档 ID 保障并发和幂等，正式环境应使用新建空库初始化，不要与采用随机成员/申请 ID 的旧版数据混用。
4. 将数据库集合权限设为“所有用户不可直接读写”，业务数据只允许通过 `cloudfunctions/api` 云函数访问。`driverSecrets`、`driverApplications`、`driverDocumentUploads`、`drivers` 和 `vehicles` 不得开放客户端直读。
5. 将 `private-driver/**` 与 `private-driver-sealed/**` 配置为私有云存储路径：客户端仅可向后端签发的临时 staging 路径上传，单文件上限 5MB；禁止列目录、覆盖 sealed 路径或直接下载。服务端确认 JPEG/PNG 内容后会迁移到随机 sealed 路径并删除 staging 文件。
6. 在 `cloudfunctions/api` 安装依赖并上传部署，云端安装即可：

   ```bash
   npm install
   ```

7. 云函数环境变量至少配置：

   - `PINBA_ENV=production`
   - `ENABLE_WECHAT_CONTENT_CHECK=true`
   - `DRIVER_CREDENTIAL_SECRET=<至少32字节的独立高熵密钥>`

   生产环境不要设置 `ENABLE_DEV_DRIVER_REVIEW=true`；司机审核应接入独立运营后台。

8. 部署每日敏感资料清理任务：删除已过期 `PREPARED` staging 文件，并在 `retentionUntil` 到期后删除 `RETENTION_PENDING` 的 sealed 文件与 `driverSecrets`；清理动作必须写审计且可幂等重试。
9. 在隐私保护指引中单独说明司机实名、驾驶证、车辆照片的用途、保存期限、撤回方式和删除渠道，并完成真实 AppID 真机验证。
10. G1 建立本地环境配置后将 `useMock` 切换为 `false`；不要把真实环境 ID、密钥或订阅模板 ID 提交到仓库。

生产环境如果没有启用微信内容安全检查，云函数会拒绝发布和用户生成内容提交，避免静默绕过审核。

## 建议数据库索引

- `activities`：`status + startsAt`、`type + status + startsAt`、`city + district + status + startsAt`、`type + status + typeData.routeId + startsAt`、`ownerId + updatedAt`。
- `applications`：`activityId + createdAt`、`activityId + applicantId + status`。
- `members`：`activityId + userId + status`、`userId + role + status`。
- `memberContacts`：成员电话敏感集合，仅云函数读写；以活动和成员确定性 ID 保存，禁止开放客户端直读权限。
- `notifications`：`userId + createdAt`。
- `reports`：`reporterId + targetType + targetId + status`。
- `communityPosts`：`status + createdAt(降序) + _id(降序)`。
- `communityReplies`：`postId + status + createdAt(升序) + _id(升序)`。
- `communityLikes`：使用目标类型、目标 ID 与调用者派生的确定性文档 ID；点赞状态按 `_id in (...) + status` 分片读取，集合禁止客户端直接读写。
- `communityRateLimits`：使用调用者、动作与固定时间窗派生的确定性文档 ID，无需额外索引。
- `directConversations`：会话列表分别建立 `participantAId(升序) + updatedAt(降序) + _id(降序)` 和 `participantBId(升序) + updatedAt(降序) + _id(降序)`；未读扫描另建 `participantAId(升序) + _id(升序)`、`participantBId(升序) + _id(升序)`。未读按不可变 ID 分页遍历，不以单页 100 条作为总量上限。
- `directMessages`：`conversationId(升序) + createdAt(降序) + _id(降序)`。消息和会话集合均禁止客户端直接读写，只经云函数鉴权访问。

## 私信功能与联调清单

私信只面向共同活动的有效成员：从成团成员空间进入会话，双方账号可用、双方成员关系有效且活动为 `FORMED / IN_PROGRESS` 时可发送最多 500 字纯文字。活动结束、成员退出或对方账号停用后，原会话参与者仍可查看历史和举报，但不能发送新消息。当前账号停用时不可继续访问。

- 聊天页可见且可发送时，每轮请求结束后约 8 秒刷新最新消息；跨页追赶并按消息 ID 合并，不覆盖已加载的历史。离屏停止轮询并忽略晚到响应。
- 用户阅读历史时不强制滚到底部、不提前清除新消息未读；返回底部后以实际取得的最新消息 ID 条件确认。ID 为不透明字符串，不比较其大小。
- 发送失败保留正文和当前页面内的 `clientMessageId`，相同正文重试不会重复入库。页面销毁后不持久化私信草稿；重开页面先检查历史再决定重发。
- 未读徽标共享上一次服务端确认值，刷新失败不伪造为 0；切换账号清空旧账号快照。此阶段不提供后台推送、在线状态或对方已读回执。

本地 `npm run verify` 覆盖 Memory/Mock 业务、前端时序和模拟 Cloud Store 查询/事务契约，**不代表真实 CloudBase 事务并发、索引或真机键盘已验证**。部署新版本 `api` 云函数并创建以上集合与索引后，使用两个真实账号完成：

1. 共同成团成员创建会话、双向发送、页面停留接收、20 条以上历史分页；第三方账号直达同一会话必须拒绝。
2. 弱网下发送后超时，同正文重试只生成一条消息；并发发送、收到新消息时的条件已读不得清掉尚未拉取的消息。
3. 退出成员/结束活动/停用对方账号后转只读并收键盘；当前账号停用后清空页面私信。
4. iOS/Android 输入多行、阅读历史收到新消息、返回底部、前后台切换、99+ 徽标与跨 Tab 刷新。
5. 云函数不可用或接口缺失时展示安全错误，不回退 Mock。检查真实云事务冲突重试、上述复合索引可用性及未读扫描的耗时/读量。

## MVP 边界

- 不接平台支付，不做资金担保。
- 不提供车辆或司机，不承接运输服务。
- 提供活动关系内的低频轮询纯文字私信，不提供任意陌生人聊天、媒体消息或后台推送；联系方式仍只在成团后由有效成员按需获取。
- 不公开手机号、二维码或微信 OpenID。
- 当前 Mock 数据只用于产品演示，正式运营还需完成真实账号、隐私政策、类目资质、内容安全和风控配置。

详细设计见 `outputs/拼吧-项目设计书-v1.0.md`，运行与验收记录见 `outputs/拼吧-MVP-运行与验收说明.md`。
