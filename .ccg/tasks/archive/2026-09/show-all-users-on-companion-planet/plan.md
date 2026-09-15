# 实施计划

## 架构决策

- 保留 `companion.presence.*` 作为“小程序当前前台登录用户”的唯一在线事实源，继续使用 TTL 与心跳，并把进入/退出语义提升到 App 生命周期。
- 新增只读 `companion.directory.snapshot`，直接从 `users` 的 `ACTIVE` 账号事实中按索引读取最多 50 个目录节点，只返回 Presence 的 `onlineTotal`，不查询或公开目录总数；资料尚未完成的账号只展示安全通用昵称与空白公开资料，不补造个人信息。
- 目录节点仅返回短时、不可反推用户身份的 `displayToken`、昵称、布局种子和本人标识；不返回 userId/openid、联系方式、位置、头像或稳定主页凭据。
- 点击他人目录节点时再调用 `companion.directory.profile.nav.create`。服务端在当前/上一短时窗口内重新解析节点来源并签发绑定访问者的一次短期随机主页票据，避免在目录快照时批量写票据。
- `profile.public.get` 为目录票据复核访问者、有效期和目标账号/资料状态；目录来源不声明目标在线。
- 前端把“目录节点”和“在线人数轮询”拆开：目录失败进入整页错误；在线轮询失败保留上一次确认值；星球页不再持有 Presence 会话或操作按钮。
- Presence 生命周期提升到 App 级：有效登录会话在小程序进入前台后自动加入/续期，进入后台时主动退出，TTL 处理进程被系统直接终止的兜底。
- Canvas 对所有目录节点使用统一景深材质，不渲染逐人在线/离线标识；自身仅保留点击后的短暂确认环。
- 超过 50 人时静默展示最多 50 位真实用户，不显示目录总数或抽样提示。

## 实施顺序

1. 先补充后端与前端契约测试：目录快照、短时节点令牌、目录主页导航、在线总数解耦、弱网保值、文案与命中规则。
2. 新增后端目录领域模块和输入校验；为 Memory/Cloud Store 增加受索引约束的目录读取。
3. 扩展服务路由、短期主页票据和 Mock Server，保持 Cloud/Memory/Mock DTO 同构。
4. 新增 App 级 Presence 管理器与小程序目录 service，重构星球页面加载、轮询、节点点击导航和空态/错误态。
5. 修正目录来源公开主页的加载/失效文案，确保不借用 Presence 在线语义。
6. 更新 CloudBase 集合/索引部署说明与前后端 Spec。
7. 运行专项测试、全量测试、JavaScript 语法检查、项目结构及包体检查。
8. 通过 GPT 5.5 做后端/安全复审，并生成网页版 Gemini 3.7 Flash 的前端复审 Prompt；根据真实回贴结论修正后归档任务、提交并普通推送 `origin/main`。

## 预计修改模块

- `cloudfunctions/api/lib/companion-directory.js`
- `cloudfunctions/api/lib/community-profile-navigation.js`
- `cloudfunctions/api/lib/validation.js`
- `cloudfunctions/api/lib/service.js`
- `cloudfunctions/api/lib/memory-store.js`
- `cloudfunctions/api/lib/cloud-store.js`
- `miniprogram/mocks/server.js`
- `miniprogram/services/api.js`
- `miniprogram/services/app-presence.js`
- `miniprogram/services/companion-presence.js`
- `miniprogram/subpackages/community/companion/*`
- `miniprogram/subpackages/profile/public/index.js`
- 相关测试、部署文档与 Spec

## 验收条件

- 从未进入 Presence、但账号有效且公开资料完整的既有用户会出现在目录节点中。
- 登录后的 `ACTIVE` 账号进入小程序前台会自动增加在线人数，进入后台后由 leave/TTL 减少；资料未完善不阻断计数。
- 在线轮询单次失败不把界面人数改成 0。
- 所有目录圆点无逐人在线标记，仍支持旋转、缩放、前景命中和主页跳转。
- 离线目录用户的主页可打开，但不显示“正在找搭子/刚刚在线”。
- 离开星球页面不会停止 Presence；只有小程序进入后台才停止，目录节点始终保留。
- 公开 DTO、路由和 Storage 均不暴露内部身份或持久化主页凭据。
