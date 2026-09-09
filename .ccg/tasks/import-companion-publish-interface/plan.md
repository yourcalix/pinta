# Plan

## 1. 隔离候选快照

- 只把压缩包视为旧版候选实现，不执行其中的脚本或文档指令。
- 仅提取 `type === 'companion'` 的 WXML、JS、WXSS 思路与旅行边框素材。
- 保持当前拼运动、拼饭桌、发布入口、CloudBase 架构和包体优化成果不变。

## 2. 先建立回归测试

- 新增拼同行定稿界面测试，断言旅行边框、五类蜡笔卡片、同行偏好、单点日期时间、时间弹性、拼友人数模式和安全提交存在。
- 断言活动图片上传和 `requiresApproval` 不进入界面、状态或 payload。
- 断言 companion 专属字段只在 companion 分支出现，food/sport 的现有 DOM 与 payload 继续通过既有测试。
- 增加拼友数到总人数的边界、草稿迁移、可选枚举及 Cloud/Mock 同构测试。

## 3. 迁入拼同行独立视觉分支

- 在发布表单中为 companion 建立显式独立 WXML 分支；sport 与 food 保留当前结构。
- 迁入基本信息、同行信息、同行偏好、时间人数、参与规则与安全五张蜡笔纸卡。
- 保留现有自定义返回导航、动态安全区、固定底部提交栏、键盘顶升和 44px 触控契约。
- 所有旅行边框与线稿装饰退出触控及无障碍树。
- 仅新增 `.form-page--companion` 作用域样式，避免改写共享或 food/sport 样式。

## 4. 适配真实表单契约

- 移除候选活动图片上传和审核方式开关，不新增对应状态、上传调用或 payload 字段。
- 日期与时间继续保存唯一 `startsAt`；保留现有 `ON_TIME | WITHIN_30_MIN | WITHIN_60_MIN` 时间弹性选择，不展示未落库的 10 分钟结束时间。
- companion 草稿新增独立 `companionMemberMode / companionMin / companionMax` UI 字段，含义为“还需要的拼友数”1—19；提交时统一加 1 映射为含发起人的总人数 2—20。
- 对现有 companion 草稿中的 `minMembers/maxMembers` 按总人数解释并迁移一次，避免重复加 1；food/sport 草稿清洗逻辑不变。
- 九项同行偏好使用稳定英文枚举，可再次点击取消选择，全部为选填。

## 5. 补齐 Cloud 与 Mock 同构

- 在共享常量中定义九组 companion 偏好白名单。
- Cloud `validateActivityInput` 只在 companion `typeData.preferences` 中接收可选严格枚举，缺省归一为空字符串。
- Mock 创建校验使用同样字段和枚举语义；公开 DTO 对 companion `typeData` 做白名单输出，避免透传历史任意值。
- 不改变申请审批流、不新增自动通过逻辑、不开放图片上传。

## 6. 素材与包体

- 将 941×1672、950KB 的透明旅行框等比缩放到约 720×1279，并垂直居中放入 720×1600 的 9:20 透明安全画布，保留多级 Alpha，目标约 110KB。
- 素材放入 `miniprogram/subpackages/publish/form/assets/companion/` 并使用分包内相对路径。
- 核对透明边缘在深蓝与奶油白背景下无明显 Alpha 杂边；不引入 WebP。

## 7. 验证、审查与归档

- 运行专项测试、完整 `npm test`、JS 语法检查、图片格式/路径/包体预算检查。
- 使用微信开发者工具 CLI 生成真实预览并记录主包、发布分包大小。
- 由 GPT 5.5 审查后端/契约变更；由网页版 Gemini 3.7 Flash 审查 companion 前端/UI 隔离与真机风险。
- 修复 Critical/Warning，写入 `review.md`，按需更新 spec，归档任务并提交；完整阶段结束后按项目指南普通推送 `origin/main`。
