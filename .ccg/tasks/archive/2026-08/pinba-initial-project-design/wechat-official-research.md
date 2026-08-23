# 微信小程序官方能力核验

- 核验日期：2026-08-23
- 核验范围：登录、隐私授权、内容安全、位置能力
- 资料边界：仅记录微信开放文档明示的产品/技术要求；合规结论仍需结合实际经营主体、服务类目与上线地区另行确认。

## 1. 登录与用户标识

官方文档：<https://developers.weixin.qq.com/miniprogram/dev/api/open-api/login/wx.login.html>

- `wx.login` 获取临时登录凭证 `code`，凭证有效期为 5 分钟。
- 小程序前端应将 `code` 发送至业务服务端，由服务端调用 `code2Session` 换取 `openid`、`unionid`（满足条件时）和 `session_key`。
- MVP 不应把微信登录态当作业务权限本身；服务端仍需签发并校验自己的会话凭证。

## 2. 用户隐私保护

官方文档：<https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/PrivacyAuthorize.html>

- 涉及处理个人信息的小程序，需要以显著方式提示用户阅读隐私政策和个人信息处理规则。
- 开发者应在小程序管理后台配置《小程序用户隐私保护指引》，只有已经声明的隐私相关接口或组件才能正常调用。
- 在调用已经声明的隐私接口或组件前，需要完成用户阅读并同意隐私保护指引的流程。
- 基础库 2.32.3 起可使用 `wx.getPrivacySetting`、`wx.openPrivacyContract` 和隐私授权相关能力；也可通过 `wx.onNeedPrivacyAuthorization` 处理按需授权。
- MVP 需要把“隐私指引配置、授权前置、拒绝后的降级路径”作为验收项，而不是上线前补丁。

## 3. 文本与媒体内容安全

官方文档：<https://developers.weixin.qq.com/miniprogram/dev/server/API/sec-center/>

- 服务端可调用 `msg_sec_check` 检查用户提交的文本内容。
- 服务端可调用 `media_check_async` 异步检查图片、音频等媒体内容。
- “拼吧”包含标题、描述、留言、评价和举报等 UGC。MVP 应在发布、编辑、评价等写入链路中加入文本安全检查，并为媒体异步检查保留状态和回调处理。
- 内容安全接口只能作为平台治理的一层，仍需配合举报、下架、封禁、审计记录和人工复核能力。

## 4. 位置能力

官方文档：<https://developers.weixin.qq.com/miniprogram/dev/api/location/wx.getLocation.html>

- `wx.getLocation` 需要 `scope.userLocation` 授权。
- 新发布的小程序需要在 `app.json` 中声明相关位置接口用途，否则接口可能无法调用。
- 位置能力受服务类目和实际使用场景约束；提审前需要核对主体资质、服务类目与页面用途的一致性。
- 地图展示通常应使用 `gcj02` 坐标类型。
- 精确位置属于高敏感信息。MVP 默认采用城市/行政区/商圈或约定地点文本进行发现和筛选，精确会合点仅在成团后按需展示，以减少隐私暴露和前期授权摩擦。

## 5. 对初版方案的直接约束

1. 登录采用“小程序临时 code + 服务端会话”模式。
2. 发布内容在服务端落库前做文本安全检查；图片若进入 MVP，则采用异步审核和待审状态。
3. 联系方式、精确位置不进入公开列表或公开详情。
4. 所有隐私接口必须有用途说明、拒绝处理和功能降级。
5. 上线准备清单必须包含：主体与类目核验、隐私保护指引配置、内容安全接口配置、举报处置机制和数据留存策略。
