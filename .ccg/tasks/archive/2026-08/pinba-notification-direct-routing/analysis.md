# 分析记录：通知受控页面直达

## CCG 后端分析状态

- 已按当前 CCG 配置调用 GPT 5.5 architect。
- 外部通道在限定等待 90 秒内没有返回正文，已终止；不把无返回结果记为分析通过。

## 当前源码事实

- 通知 DTO 当前只有 `id/type/activityId/title/read/createdAt/readAt`，已脱敏，不包含 `userId`。
- 现有类型包括 `NEW_APPLICATION`、`APPLICATION_APPROVED`、`GROUP_FORMED`、`APPLICATION_CLOSED`、`APPLICATION_REJECTED`；Mock 种子直接覆盖新申请与成团。
- “我的”页点击任何通知都先标记已读，然后固定跳详情页；`ACCOUNT_DISABLED` 已能停止后续导航。
- `NEW_APPLICATION` 的正确上下文是申请管理页；`GROUP_FORMED` 的正确上下文是成团页。
- `APPLICATION_APPROVED` 可能发生在活动尚未达到目标人数时，此时成团页会错误展示“组团成功”，必须落详情页；`APPLICATION_CLOSED/REJECTED` 也落详情页。
- 真实服务通知无需 `App.onShow` 监听：微信根据发送时的 `page` 打开目标页，目标页自行解析 `id`。
- manage/group 页目前都在空 ID 时跳过加载并永久保持 `loading:true`，且缺少详情页已有的请求序号保护。
- manage/group 加载错误仍可能直接展示非受控 `error.message`，作为外部冷启动目标页需要进一步封闭映射。

## 主会话推荐候选

1. 服务端按通知 `type` 计算有限枚举目标 `MANAGE | GROUP | DETAIL`，在 DTO 序列化时输出；不在数据库中存任意 URL，也不信任客户端传入路径。
2. 客户端路由器只接受目标枚举与 `activityId`，从本地 allowlist 生成路径；未知目标降级 `DETAIL`，缺失/畸形 ID 返回发现页。
3. 后端保留一个可用于未来订阅发送的 `buildNotificationPage(type, activityId)` 纯函数，但本轮不调用微信发送 API。
4. 抽取可复用的活动 ID 防御性解析函数供 detail/manage/group 使用，避免三份 URI 解码逻辑漂移。
5. manage/group 增加空 ID、请求竞态和安全错误操作；无权限优先返回公开详情，无 ID/不存在/下架返回发现，网络类错误允许重试。
6. 用户页标记已读普通失败仍导航；全局已处理错误停止；路由计算本身绝不执行通知携带的自由文本 URL。

## 待 Gemini 重点判断

- 站内任务卡是否需要显示“查看申请/进入成团/查看详情”的目标提示。
- manage/group 冷启动无权限、失效与网络错误分别应提供“查看详情”“返回发现”还是“重新加载”。
- 服务通知直达后页面栈深度为 1，错误操作必须避免依赖 `navigateBack`。

## 网页版 Gemini 3.7 Flash 分析回传

- 推荐“后端 DTO 语义枚举 + 客户端白名单路由器”，不传输自由 URL。
- 确认 `NEW_APPLICATION → MANAGE`、`GROUP_FORMED → GROUP`，其余现有类型与未知类型均安全降级 `DETAIL`。
- 明确 `APPLICATION_APPROVED` 未必成团，必须落详情页，不能制造“组团成功”假象。
- Critical：manage/group 空 ID 永久 loading；需下沉参数检查。
- Warning：两页缺少单页栈错误操作和 `_loadSeq` 竞态保护。
- `FORBIDDEN` 提供“查看活动详情”，`NOT_FOUND/TAKEDOWN` 返回发现，网络错误允许重试，账号受限交由全局 Modal。

## 综合校正

- 通知 DTO 中的 `activityId` 是服务端原始不透明 ID，客户端构造 URL 时直接编码，不能先 URI 解码；只有目标页面接收 query 时执行一次防御性解码，避免双重解码。
- 后端纯函数输出未来微信服务通知可用的无前导斜杠 `page`；客户端路由器输出小程序导航使用的带前导斜杠路径。
