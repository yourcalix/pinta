# 需求与实施边界

## 目标

- 将用户提供的白棕小狗与黑猫空状态 IP 接入现有微信小程序，统一页面级成功空态、搜索无结果和首屏失败态。
- 复用并升级现有主包 `components/empty-state`，不建立第二套重复组件。
- 保持 Loading/Skeleton、品牌 Modal 与 Toast 的既有职责边界。

## 组件契约

- 支持 `empty-activity / empty-joined / empty-message / empty-search / empty-favorite / empty-network` 六类插画映射。
- 支持标题、说明、按钮、loading、disabled、自定义插画、small/default/large、一次性入场动画、图片懒加载、无障碍图片文案和 action 事件。
- 兼容现有 `actionText / symbol / bindaction` 调用，业务路由与重试继续归调用页面负责。

## 首批真实页面

- 发现活动与全部活动：活动空态、筛选/搜索空态、首屏网络失败。
- 发现讨论：无讨论、搜索无结果、首屏网络失败；替换旧专用讨论空图。
- 我的活动：按当前发起/参与/成团/历史分类选择 activity 或 joined 语义。
- 消息主页与讨论动态：无私信/无互动使用 message，错误使用 network。
- 附近拼吧：范围内无活动使用 activity，服务失败使用 network。
- 申请管理等已使用公共 empty-state 的分包页面继续兼容升级。

聊天页内“尚无消息”属于局部会话引导，不在首批强制替换，避免页面级大插画造成视觉疲劳。

## 状态边界

- loading：保持现有 Skeleton/Loading，不显示空状态。
- success + data：显示真实内容。
- success + empty：显示对应业务 IP。
- initial error + no data：显示 network IP 与真实重试操作。
- 下拉刷新或续页失败且已有内容：保留内容和局部错误，不切换整页空状态。

## 资源与包体

- 原始 768px PNG 不直接入包。
- 裁去透明冗余和生成残片，按真实显示尺寸缩放为微信稳定的索引色透明 PNG。
- 六张图只保留一份主包资源；同步清理已无运行引用的旧发现页素材和旧讨论空图。
- 主包必须继续满足 1.71MiB 工程预算，不能放宽阈值。

## 不改动

- 不调整 TabBar、页面信息架构、API、业务状态机或已确认卡片布局。
- 不把空状态用于确认、权限、删除、成功或轻提示。
- 不新增演示页到正式路由。
