# G0 CCG 综合分析

## 已确认事实

- 当前唯一受微信隐私规则约束的客户端接口是成团页主动复制时调用的 `wx.setClipboardData`。
- 微信官方《小程序用户隐私保护指引内容介绍》将 `wx.setClipboardData` 和 `wx.getClipboardData` 归入剪贴板信息处理。
- `group.contact` 是服务端业务权限接口，负责活动状态、成员资格和访问审计；微信隐私授权不能成为它的客户端可伪造参数。
- `wx.onNeedPrivacyAuthorization` 从基础库 2.32.3 开始支持，采用覆盖式注册；官方没有提供对应的 `offNeedPrivacyAuthorization` API。
- 官方要求注册监听后必须调用 `resolve`；同意时需要在 `open-type="agreePrivacyAuthorization"` 按钮事件后传入按钮 ID。

## CCG 综合决策

1. 服务端 `group.contact` 契约和测试保持不变。
2. 新增单例隐私监听桥接服务，避免组件重复覆盖监听；组件销毁后清空活动处理器，无活动处理器时对意外隐私请求明确 `disagree`，不能悬挂。
3. 新增可复用 `privacy-popup`，但 G0 只在成团页挂载；游客发现页和公开详情不注册交互组件。
4. 复制按钮仍直接调用真实隐私接口，由微信在需要时触发监听；旧基础库没有新隐私拦截能力时继续调用原生复制 API。
5. 删除成功后的自定义 Toast，避免与微信原生反馈重叠；失败或拒绝时提供可理解提示。
6. 联系信息改为明确支持 `user-select` 的文本组件，使拒绝授权后的手动复制说明真实可行。
7. AppID 通过被 Git 忽略且优先级更高的 `project.private.config.json` 配置；仓库继续保留 `touristappid`。CloudBase 环境和订阅模板仍为空，留到 G1。

## 不采纳或校正

- 不新增手机号、位置、头像、通讯录或二维码权限。
- 不把隐私弹窗放在游客首屏，也不在“查看联系方式”服务端请求前索取剪贴板授权。
- 不尝试调用不存在的 `wx.offNeedPrivacyAuthorization`。
- 不只提示“可长按复制”而维持不可选择的 `<view>`；必须同步提供可选中文本。
