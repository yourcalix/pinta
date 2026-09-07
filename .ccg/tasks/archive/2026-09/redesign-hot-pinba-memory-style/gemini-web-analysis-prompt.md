请把下面这段粘贴到网页版 Gemini 3.7 Flash；如果方便，请同时上传当前发现页截图。拿到结果后直接贴回 Codex：

<GEMINI_WEB_PROMPT>
ROLE: frontend UI/UX analyzer and reviewer

PROJECT:
微信原生小程序“拼吧”，面向澳门附近用户的轻社交拼活动平台。品牌主色为 #16A36A。发现页采用深蓝画报头部、白色连续内容面板和杂志式章节设计。

REVIEW TARGET:
发现页“热门拼吧”模块的背景与容器视觉改造。目标是让它明显继承同页“成团记忆”的背景风格与画报质感，同时仍是可浏览、可翻页的真实活动列表，而不是静态故事拼贴。

CURRENT STRUCTURE:
1. 标题已是居中的英文水印 HOT PINBA + 中文“热门拼吧”，与 OUR STORIES + “成团记忆”同一排版基线。
2. 热门拼吧每页最多显示 5 张活动卡，分页器为“上一页 / 第 N 页 / 下一页”。
3. 单张活动卡为左右分栏画报：标准屏左侧 46% 主题插画与成员头像，右侧 54% 展示单点日期、状态、标题、地点、发起人和非空说明；320px 为 43:57。
4. 成团记忆是 347:430 亮蓝专题板，使用本地 Baseline JPEG 背景、#4FA4F8 → #207BE5 渐变、径向柔光、白黄倾斜艺术字以及半透明白色槽位。
5. 当前热门拼吧列表直接铺在白色页面上，缺少与成团记忆呼应的专题背景容器。

PROPOSED DIRECTION TO REVIEW:
在 HOT PINBA 标题下增加独立 `hot-pinba-panel`，包裹加载态、五张活动卡、空态和分页器。专题板复用“成团记忆”的本地背景纹理、蓝色渐变遮罩和径向柔光，但不采用 347:430 固定比例；高度由五张卡与状态自然撑开。活动卡保持白色或高透明度磨砂白实体表面，保证正文可读。分页按钮改为半透明白色胶囊。筛选结果标题仍可显示“筛选结果”。

KNOWN CONSTRAINTS:
- 微信原生 WXML/WXSS，不引入 UI/动画库。
- 仅使用主包内 PNG/JPEG，禁止 WebP 与自由远程图。
- 活动、成员、发起人和人数必须来自真实公开 DTO；禁止虚构“多少人玩过”、促销、评分或假照片。
- 不更改搜索、筛选、游标分页、活动跳转及每页 5 条逻辑。
- loading / empty / error / paging 必须完整保留。
- 375px 与 320px 均需安全；触控热区 >= 88rpx；大字体模式不能裁字。
- “成团记忆”仍是未来 UGC 的不可点击静态预告，不能与活动列表合并或混淆。
- 需要控制背景强度，避免五张活动卡叠加后页面过于沉重或视觉噪声过大。

REVIEW QUESTIONS:
1. `hot-pinba-panel` 应如何复用成团记忆的色彩、背景图、光晕和圆角，才能同源但不抢走压轴模块的视觉重心？
2. 五张白色活动卡在蓝色画报底板中的最佳内边距、卡间距、透明度、边框与阴影建议是什么？
3. HOT PINBA 标题应留在面板外还是进入面板顶部？分页器应如何融入？
4. 375px、320px 和大字体模式下有哪些溢出、性能或可读性风险？
5. 是否应直接复用现有 `formed-memory-editorial-bg.jpg`，还是仅复用渐变语言并创建更克制的新背景？请说明理由。

OUTPUT:
1. 总体判断与最主要问题
2. Critical / Warning / Info 分级问题清单
3. 每个问题的具体修改建议及理由（包含 rpx、颜色、透明度、圆角、阴影等可实施参数）
4. 最终推荐的模块结构与 375px / 320px 尺寸规范
5. 必须保留、必须修改、暂不采纳的清单
6. 需要产品负责人决定的问题（没有则写“无”）

Do not assume missing business facts. Separate objective usability issues from subjective visual preferences. Do not output implementation code.
</GEMINI_WEB_PROMPT>
