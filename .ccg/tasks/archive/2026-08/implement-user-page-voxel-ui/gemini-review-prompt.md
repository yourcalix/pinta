请把微信开发者工具或真机中最新的“我的”页面截图上传到网页版 Gemini 3.7 Flash；最好同时提供乘客视图和司机视图，然后粘贴以下内容：

<GEMINI_WEB_PROMPT>
ROLE: frontend UI/UX implementation reviewer

PROJECT:
“拼吧”微信小程序，澳门校园公益合乘试点。品牌视觉为浅灰绿背景、翡翠绿主色、白色圆角卡片与 3D 体素拼豆/isometric 透明素材。当前审查对象是已经写入真实 WXML/WXSS 的“我的”页面，不是概念图。

REVIEW TARGET:
审查随消息上传的最新“我的”页面真实运行截图。页面已完成以下实装：
1. 资料头像复用 avatar-passenger-a/b，浅绿圆角底座；右侧低透明 brand-puzzle 装饰。
2. 保留独立一级视图切换“我的拼车/司机任务”；二级“我的发布/我的参与”改为文字 Tab + 底部绿色指示线。
3. 三列统计只展示真实 tasks/owned/joined 数量，不展示减碳等虚构指标。
4. 待处理区域仅在 tasks.length > 0 时渲染；待办整卡点击。
5. 发布/参与列表直接复用发现页 activity-card，因此头像、起点、车辆、终点建筑和读屏文案均复用同一套实现。
6. 司机未认证/审核中/需补资料使用页面内引导卡；已认证司机显示车辆数和已承接任务。
7. Mock 演示身份面板移动到页面底部，正式 Cloud 模式不展示。
8. 底部继续使用原生 TabBar 的 discover/publish/user active/inactive 六张规范图标。

KNOWN CONSTRAINTS:
1. 微信小程序 custom navigation；正文顶距继续使用已验证的 contentTopInset 动态安全区计算。
2. 页面必须适配 320px、小程序大字号、iOS/Android Safe Area 和至少 44px 热区。
3. 主包不得新增图像；所有体素图片均来自现有 PNG-32 素材。
4. 资料、通知和行程卡的整卡可点击；装饰图片均 aria-hidden，活动卡外层提供综合 aria-label。
5. 未认证司机允许进入司机视图，但只能看到认证引导，乘客功能不受影响。
6. 不新增金额、支付、商业订单、信用或未经验证的实名徽章。
7. 自动化测试 183/183 通过；微信开发者工具真实 Preview 编译通过；总包约 818.1 KB，主包约 721.7 KB。

REVIEW QUESTIONS:
1. 资料卡、一级视图切换、三列统计、条件待办、二级列表 Tab 与行程卡的层级是否清楚？是否仍有 Dashboard 堆叠感？
2. 一级胶囊切换与二级下划线 Tab 是否已经足够区分作用域？
3. 与发现页相比，圆角、阴影、留白、翡翠绿权重和体素素材比例是否一致？
4. 资料头像 A/B 在浅绿底座中的裁切、尺寸和接触阴影是否自然？品牌拼图水印是否干扰文字？
5. 三列真实统计在 320px 与大字号下是否安全？数字和标签是否存在折行或读序问题？
6. activity-card 复用到“我的”页后，信息密度和体素视觉带是否适合该页面，是否需要页面级间距微调？
7. 待处理卡在长标题、大字号下，左侧拼图、中部标题与右侧动作是否会挤压？
8. 司机认证引导卡、已认证卡和司机任务卡是否保持品牌统一，同时又能通过低饱和蓝区分司机语义？
9. 顶部微信胶囊、页面正文和底部原生 TabBar 是否存在安全区或视觉碰撞？
10. 仅列出真实实现中需要修复的问题；不要要求新增无业务依据的数据或新图片素材。

OUTPUT:
1. 执行结论
2. Critical / Warning / Info 分级问题清单
3. 每项问题的最小修复方案
4. 320px、大字号、Safe Area 与无障碍专项结论
5. 可直接保留的实现
6. 自动化可覆盖项与必须真机验证项
7. 最终结论：【可交付】/【调整后可交付】/【不可交付】

Do not assume missing business facts. Separate objective usability defects from subjective visual preferences. Do not output a full page rewrite or unrelated new features.
</GEMINI_WEB_PROMPT>
