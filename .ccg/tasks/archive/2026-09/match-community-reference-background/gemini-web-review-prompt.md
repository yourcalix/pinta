# Web Gemini 3.7 Flash 最终审查提示词

```text
ROLE: frontend UI/UX reviewer

请同时上传并对比两张图：
1. 原始论坛参考图（粉白蓝柔焦背景）；
2. 最新微信开发者工具里的“拼吧社区”实现截图。

目标：判断最终实现是否已在真实数据边界内尽可能一比一还原参考图，尤其是背景色域、模块比例、纵向位置、圆角、文字层级和首屏密度。

已完成的实现：
- 使用新生成的本地 `/assets/images/community/community-ambient-bg.jpg` 作为固定视口背景；952×1653、约69KB、Baseline JPEG，iOS微信兼容。
- 背景顶部奶白、右上柔粉、中部淡紫、下部冰蓝，70%以下平滑收敛到 #EFF4FA；背景无文字、人物、Logo、水印或UI。
- 背景节点使用 position:fixed、100vw×100vh、pointer-events:none、translateZ(0)，内容独立层级，不参与滚动。
- 页面JSON改为黑色状态栏文字，顶部占位 #FCFAFA，底部 #EFF4FA，下拉刷新使用dark。
- 顶部标题改为黑色32rpx/800，仍复用动态contentTopInset。
- 公告条为100rpx、24rpx圆角、白底轻阴影；内容调整为单行“社区规范 + 友善交流，共建安全拼单社区”。
- 双快捷卡为112rpx、间距16rpx、24rpx圆角；左卡粉色、右卡浅蓝，文案为“发起讨论/寻找同频搭子”和“社区守则/友善发帖规范”。
- 栏目为72rpx，“最新讨论”黑色32rpx/800，48×6rpx绿色下划线，右侧“按发布时间”灰色。
- 帖子卡白底24rpx圆角、min-height 220rpx、轻阴影；64rpx单字头像、三行纯文本、真实点赞/回复。
- 320px下横向边距20rpx，公告92rpx、快捷卡104rpx、帖子卡200rpx。
- 底部继续预留calc(160rpx + env(safe-area-inset-bottom))。

真实业务边界：
- DTO只有昵称、正文、发布时间、点赞数、回复数；没有图片、热门话题、置顶、浏览量、标签或多分类Tab。
- 因此没有复制参考图里的假帖子图片、围观数、置顶或“新回/我发/我回/我赞”。
- 发帖门禁、帖子详情、游标分页、加载/空/错误状态均保持不变。

验证结果：
- 社区专项8/8通过。
- 全量测试313项：312 pass、0 fail、1 historical skip。
- 项目检查：215 JSON、149 JS、21 WXML通过。
- 背景文件签名确认为Baseline JPEG，且小于120KB。
- 微信开发者工具编译和截图检查通过，无横向溢出、图片空白、底栏遮挡或状态栏辨识问题。

请重点检查：
1. 新背景与参考图的粉、白、蓝区域位置和强弱是否足够一致；
2. 标题、公告、快捷卡、栏目、帖子卡的几何比例和纵向位置是否需要rpx级调整；
3. 固定背景的z-index/isolation是否存在真机不可见、闪烁或拦截点击风险；
4. 320px、大字体、长昵称、长正文和分页状态下是否安全；
5. 是否存在必须修复的Critical或Warning。

OUTPUT:
1. 总体还原度评分与结论
2. Critical / Warning / Info分级问题
3. 每个问题的触发条件、用户影响和最小rpx级修改
4. 背景、顶部、双快捷卡、栏目和帖子卡逐区对比
5. 已被代码与截图证实的结论
6. 必须真机验证的项目
7. 最终交付结论（可以交付 / 修复后交付）

Do not invent missing business data. Do not recommend fake images, fake tabs, views, pinned labels or topics.
```
