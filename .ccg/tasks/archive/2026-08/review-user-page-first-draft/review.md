# “我的”页面首稿综合审查结论

## 必须修改

1. 底部 TabBar 只使用现有六张规范图标；“我的”使用 `tab-user-active.png`，发现与发布使用各自灰色 inactive 图标。
2. 删除视觉稿中新生成的绿色人形、蓝色车辆、统计图标和额外蓝色方块，不增加主包素材。
3. 资料头像直接复用 `avatar-passenger-a.png` 或 `avatar-passenger-b.png`，并加浅绿色圆角底座。
4. 一级“我的拼车/司机任务”与二级“我的发布/我的参与”使用明显不同的视觉样式，避免双重 Segmented Control 混淆。
5. 行程卡复用发现页素材与信息/视觉带结构；320px 下头像组和路线视觉带允许上下分行，不能互相挤压。
6. 顶部继续使用现有 `contentTopInset` 安全区计算，资料卡与微信胶囊保留呼吸间距。
7. 待处理卡整卡可点击，不使用类似 Switch 的右侧胶囊控件。

## 建议修改

1. 保留独立一级视图切换，但压缩为轻量 44px 控件；不塞入资料卡右上角。
2. 三列统计只展示真实存在的 `tasks / owned / joined` 数量，以 WXML 数字和标签呈现；可使用单个低透明 `brand-puzzle.png` 水印，不为每列增加图标。
3. 无待处理事项时不渲染完整通知卡，仅通过统计中的 0 表达，减少首屏卡片堆叠。
4. 司机未认证、审核中、需补资料状态允许进入司机视图，并在页面内显示认证引导卡，不使用拦截弹窗。

## 暂不采纳

1. 不使用“减碳贡献、同行友友”等尚无服务端事实字段的指标，避免展示不可验证数据。
2. 不将一级角色切换合并进资料卡右上角：资料卡已有头像、昵称、状态与编辑入口，320px 和大字号下空间不足。
3. 不新增消息中心；待处理通知继续精准跳转到已有活动上下文。

## 现有素材映射

- 资料头像：`avatar-passenger-a.png` / `avatar-passenger-b.png`
- 资料卡品牌装饰：`brand-puzzle.png`
- 空位：`avatar-passenger-empty.png`
- 起点：`node-start-green.png` / `node-start-blue.png`
- 终点：`node-end-taipa.png` / `node-end-golden-dragon.png`
- 车辆：`ride-car-green.png`
- TabBar：现有 discover/publish/user active/inactive 六张图

## 最终判断

首稿视觉语言可保留；完成以上结构和素材收敛后可进入 WXML/WXSS 实装。
