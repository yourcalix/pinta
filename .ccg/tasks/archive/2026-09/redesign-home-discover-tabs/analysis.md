# 主会话初步分析

## 路由策略

保留现有物理路径，仅改变用户可见导航语义：`pages/discover/index` 对应“首页”，`pages/community/index` 对应“发现”。这样能避免活动详情、通知、安全错误和分享冷启动中的大量既有回退路径被无谓迁移。

## 参考图可吸收部分

- 温暖米白背景与大圆角生活方式 Hero。
- 顶部轻量问候、主标题与辅助动作的左右层级。
- 三张等宽柔和彩色快捷卡。
- 下方三列/卡片式“正在发生”内容区。
- 白色悬浮胶囊 TabBar、黑灰图标、中央黑色圆形发布按钮、黄色选中微标。

## 必须纠偏部分

- 不展示无来源天气、通知红点或虚构邻里照片。
- 首页 Hero 使用现有受控本地插画/视觉资产或纯 CSS 构图，不引入未经审核 UGC。
- 下方内容使用真实活动 DTO；原社区页变为“发现”后继续使用真实公开帖子 DTO。
- 三快捷卡只能跳转到已经存在的页面或页内区域。

## 预计受影响文件

- `miniprogram/app.json`
- `miniprogram/custom-tab-bar/index.js|wxml|wxss`
- `miniprogram/pages/discover/index.wxml|wxss|json`，必要时少量调整 `index.js` 展示状态
- `miniprogram/pages/community/index.wxml|wxss|json`，必要时少量调整 `index.js` 展示文案/入口
- 与导航、首页、发现页结构相关的测试
- `.ccg/spec/frontend/index.md`

## Web Gemini 3.7 Flash 结果综合

### 必须修改

- TabBar 改为 Concept A 悬浮白色胶囊，中央黑色圆形加号，选中项使用黑色与黄色圆点。
- 全局从深蓝画报切换为 `#F9F7F2` 温暖米白生活方式视觉。
- 首页使用紧凑问候、340rpx Hero、三张真实功能快捷卡和活动流。
- 保留物理路由、每页 5 条游标分页与 46:54 活动卡契约。

### 采用的建议

- `OUR STORIES` 收敛为 160rpx 米黄静态预告条，不再保留高饱和大蓝板。
- 中间快捷卡“社区动态”跳转新“发现”Tab。
- Hero 使用现有主包透明 PNG 与 CSS 柔光过渡，为未来 Canva 3D 主图保留稳定插槽。

### 暂不采纳

- 不伪造天气、通知红点、照片动态、邻里人数或不存在的日历筛选。
- 不迁移物理路由。
- 不把分页按钮缩到 84rpx，继续遵守项目 88rpx 最小触控热区。
