# 新用户随机欢迎 IP 实施计划

## 综合结论

- 采用首页顶层浮层，不新增可见路由跳转。
- 使用微信官方分包异步化：`pages/discover` 通过 `componentPlaceholder` 异步引用 `subpackages/onboarding` 内的欢迎组件；组件与图片同包，避免非法跨包资源引用。
- 欢迎卡只在图片成功解码、现有启动层完全退出且当前处于首页时打开。
- 六张图完整等比显示，禁止 `aspectFill`；标准屏宽 `min(72vw, 540rpx)`，短屏降为 `58vw`，仅保留“开启拼吧”和右上角关闭。
- 服务端在新建账号时一次性写入稳定 variant；旧账号缺少欢迎字段时直接视为已跳过，不补弹。
- 点击主按钮或关闭均立即退场并异步幂等确认；确认失败时服务端继续保持 `PENDING`，同一 App Session 不重复骚扰，下次冷启动可重试同一张图。

## 实施步骤

1. 新增共享欢迎契约模块：campaign、六个 variant、稳定分配、公开奖励 DTO 与状态解析。
2. 修改 MemoryStore / CloudStore：新账号创建时携带 `PENDING` 欢迎事实；新增当前账号幂等 ack，CloudBase 使用 doc 级事务。
3. 扩展 Service / Validation / Mock / 客户端 user service：增加 `welcome.ack`，`auth.login` 返回脱敏欢迎 DTO，不接收或返回用户 ID。
4. 调整 App 与首页协调：缓存登录返回的欢迎候选，等待启动层退场后挂载异步组件；处理图片成功、图片失败、关闭、切后台和 TabBar 恢复。
5. 将六张源 PNG 等比转换为优化 Baseline JPEG，放入 onboarding 分包组件资源目录；逐张确认像素比例、格式和体积。
6. 在 `app.json` 注册 onboarding 分包和首页预下载，在首页 JSON 中使用跨分包占位组件。
7. 增加后端状态机、Mock 契约、首页时序、组件结构、图片尺寸/格式、分包与包体预算测试。
8. 运行专项测试、完整 `npm run verify`、微信开发者工具预览编译和 git diff 审查。
9. 按 CCG 路由执行后端 GPT-5.5 与前端网页版 Gemini 复审；修复 Critical/Warning 后归档任务并提交。

## 明确不采用

- 不使用每次渲染 `Math.random()`。
- 不以 `profileComplete` 判断新用户。
- 不用本地 Storage 代替服务端跨设备事实。
- 不让主包页面直接引用分包图片。
- 不使用独立欢迎页、`aspectFill`、虚假的“稍后再看”或重复大段叠字。
