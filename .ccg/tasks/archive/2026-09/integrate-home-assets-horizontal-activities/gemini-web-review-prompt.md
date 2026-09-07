ROLE: frontend reviewer

请审查一个微信小程序首页的前端改造。只做审查，不要假设未提供的业务字段，不要建议伪造数据。

## 用户目标

1. “附近拼吧 · 正在发生”首屏固定展示 3 个真实活动，严格参考 Concept A 的横向一行三列紧凑卡片排版。
2. 其余活动通过“查看更多”按每批 3 条原地追加，并始终以完整三列行展示；弱网加载时保留已有卡片。
3. 接入用户依次提供的 10 张透明 PNG：3 张首页快捷卡插图、通知、搜索、首页、发现、消息、我的、发布加号。
4. 首页 Hero 中间大插图继续留空，等待后续素材。
5. 保留真实活动 DTO；不展示虚构浏览量、天气、图片或社交数据。

## 截图回调后的视觉参数

- 用户对首版截图反馈“相较原参考图整体偏小”。本轮据两张对比图统一放大比例，而非只放大单个 PNG。
- Hero 标准屏由 360rpx 提升至 560rpx，320px 由 320rpx 提升至 500rpx；Hero 主标题提升至 52rpx（窄屏 46rpx）。主插画仍为空槽。
- 快捷卡标准屏为 220rpx 高、与 Hero 重叠 98rpx，插画槽由 80rpx 提升至 124rpx；窄屏为 200rpx 高、插画槽 110rpx。
- 375px / 750rpx：活动区可用宽 702rpx，3 × 220rpx 卡片 + 2 × 21rpx 间距；卡高 320rpx。
- 320px / 640rpx：活动区可用宽 600rpx，3 × 192rpx 卡片 + 2 × 12rpx 间距；卡高 286rpx。
- 每张卡依次展示：40rpx 发起人头像和昵称/日期、两行 24rpx 活动标题、132rpx 固定类型插画封面、真实人数容量胶囊；窄屏同步按比例收敛。
- 地点、完整时间、状态等完整信息仍保留在整卡 aria-label 中。
- 系统大字模式降级为单列，避免三列文字挤压。
- 加载下一批时追加 3 个同尺寸骨架卡，已有卡片不销毁。
- 快捷卡插图输出 160×160 RGBA PNG；顶部入口 80×80；Tab 图标 96×96；10 张资源共 108KB。
- TabBar 图标通过 opacity 区分激活/未激活，不使用 CSS filter；中央黑色发布按钮使用白色加号图。
- 用户最后补发的“我的”和“加号”与先前文件 SHA-256 完全相同，已去重。

## 主要改动文件

- miniprogram/pages/discover/index.wxml
- miniprogram/pages/discover/index.js
- miniprogram/pages/discover/index.wxss
- miniprogram/components/activity-card/index.wxml
- miniprogram/components/activity-card/index.js
- miniprogram/components/activity-card/index.wxss
- miniprogram/custom-tab-bar/index.wxml
- miniprogram/custom-tab-bar/index.js
- miniprogram/custom-tab-bar/index.wxss
- tests/home-concept-redesign.test.js
- tests/custom-tab-bar.test.js
- tests/discover-image-cards.test.js
- tests/discover-editorial-sections.test.js
- tests/discover-pagination.test.js
- tests/discover-profile-style.test.js

## 已完成验证

- 微信开发者工具编译成功。
- 微信开发者工具独立模拟器截图确认：3 张快捷卡素材主体大小接近参考图；Hero 保持空白且预留了正式插画的主视觉高度；首批 3 张活动严格同一横排；活动内容较首版明显放大；悬浮 TabBar 正常。
- 无障碍树确认每张活动卡只暴露一个聚合焦点，播报真实类型、标题、状态、完整时间、地点与人数。
- npm run verify：315 项测试，314 pass、0 fail、1 historical skip。
- 静态扫描：220 JSON、150 JS、21 WXML 全部通过。
- git diff --check 通过。

## 请重点审查

1. 三列卡片在 375px、320px 和系统大字模式下是否存在破框、信息层级或触控风险。
2. 每批追加 3 条的加载态、末页不足 3 条、快速点击、弱网失败等状态是否需要额外前端防御。
3. 图片尺寸、透明边距、object-fit、TabBar 激活态和中央按钮是否符合 Concept A 的比例与视觉层级。
4. Hero 留空是否会出现破图、占位文字或布局跳动。
5. 微信小程序 WXML/WXSS/ARIA 与性能兼容性问题。

## 输出格式

请给出：

1. 总体还原度与是否可交付。
2. Critical / Warning / Info 分级问题；没有则明确写“无”。
3. 每个问题标注具体文件/选择器、触发条件、用户影响、最小修改建议。
4. 明确区分“代码和开发者工具已证实”与“必须真机继续验证”。
5. 不要提出偏离用户当前范围的大改版，也不要要求补造不存在的数据。
