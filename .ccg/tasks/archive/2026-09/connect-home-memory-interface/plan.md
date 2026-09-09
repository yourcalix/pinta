# Plan

## 1. 产品与数据边界

- 将首页“琐碎回忆”从 Toast 升级为真实页面入口，但不把专题画报重新挂载进首页固定单屏。
- 新页面当前只恢复已归档的受控预告态：完整呈现 `OUR STORIES / 分享你的成团记忆` 与三格空槽。
- 不调用 `activity.memories`，因为该接口返回的是 `FORMED` 活动事实而非用户主动发布的故事；不新增后端、上传、作者、图片、正文、点赞或详情跳转。

## 2. 先建立回归测试

- 新增“琐碎回忆”页面测试，锁定 347:430 画报比例、三格严格等高几何、背景资产、艺术标题、聚合无障碍和不可点击空槽。
- 更新首页测试：入口文案保持不变，点击行为改为防重复 `navigateTo`，导航失败安全释放锁并提示。
- 更新分包路由测试，保证新页面属于 `subpackages/activity`，主包不新增大图。
- 保留首页不直接挂载 `memory-panel`、不调用 `activity.memories` 的断言。

## 3. 恢复独立专题页

- 新建 `subpackages/activity/memories/index.{js,json,wxml,wxss}`，使用原生导航栏和暖米白页面底色。
- 复用保留的 `/assets/images/discover/formed-memory-editorial-bg.jpg`，按 347:430 画报比例恢复亮蓝渐变、柔光、白黄倾斜艺术字、相机线稿与三格空槽。
- 标准屏按 `694×860rpx`、左右 `315rpx`、间距 `16rpx`；320px 按 `600×744rpx`、左右 `272rpx`、间距 `12rpx`。
- 所有内部装饰退出无障碍树和触控，只由外层提供一次稳定的预告语义；页面底部避让 Safe Area。

## 4. 接通首页入口

- `handleHomeShortcut('memories')` 改为进入 `/subpackages/activity/memories/index`。
- 增加页面级导航 pending 锁，防止连点重复入栈；失败时释放锁并给出安全 Toast。
- 更新首页快捷卡 `aria-label`，去掉“按钮只会弹即将上线”的旧语义，同时不改变卡片可见标题、副标题、尺寸和其他首页结构。

## 5. 验证、审查与归档

- 运行专项测试、完整 `npm run verify`、路径/图片格式/包体预算检查与 `git diff --check`。
- 使用 GPT 5.5 核对数据/隐私边界，网页版 Gemini 3.7 Flash 分析并复审页面视觉、窄屏、无障碍和入口交互。
- 修复 Critical/Warning，更新前端 spec，写入 `review.md`，归档 CCG 任务，提交并推送 `origin/main`。
