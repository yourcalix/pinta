# 拼吧后端规范

## 架构

- MVP 使用一个聚合 CloudBase 云函数作为 BFF，内部按领域服务拆分，不在函数入口堆业务规则。
- 业务核心必须与 CloudBase SDK 解耦，通过 Store、Moderation、Clock、IdGenerator 等端口注入，允许 Node 内置测试直接运行。
- 小程序端不得直接读写业务集合；所有读写都通过稳定的 action 契约调用云函数。
- 默认使用 CommonJS 和 Node.js 18 兼容语法，避免本机 npm 版本不匹配带来的构建依赖。

## 身份与权限

- 公开列表和公开详情允许游客读取脱敏 DTO。
- 已存在但状态非 `ACTIVE` 的账号统一返回 `ACCOUNT_DISABLED`；写操作必须在读取幂等缓存前检查账号状态，停用后不得重放旧成功结果。
- 发布、申请、管理、举报、联系人读取等动作必须有可信 `openid`；调用方传入的用户 ID 不作为身份依据。
- 联系信息使用独立接口，仅在活动已成团且调用者是有效成员时返回，并写审计记录。
- 运营动作必须显式检查角色；不得依赖前端隐藏按钮。

## 状态与并发

- 活动状态：`DRAFT | RECRUITING | FORMED | IN_PROGRESS | COMPLETED | CANCELLED | EXPIRED | SUSPENDED`。
- 申请状态：`PENDING | APPROVED | REJECTED | WITHDRAWN | LEFT | EXPIRED | CANCELLED_BY_ACTIVITY`。
- 申请提交必须记录用户同意“获批后自动加入并占位”。
- 批准申请时在事务中同时检查活动状态、容量和重复成员；批准即占位。
- 达到目标人数自动成团。任何时刻有效成员数不得超过 `targetMembers`。
- 所有写动作接收幂等键；状态转换必须校验源状态并写审计记录。
- CloudBase 文档数据库事务内只使用 `transaction.collection(...).doc(id)`；不要在事务内调用 `where()`。需要跨实体唯一性时使用由业务自然键派生的确定性文档 ID。
- 事务后批量补偿动作必须可重复执行；即使主实体已经到达最终状态，重试仍需重新检查并补齐未完成的关联状态。
- 活动公开问答使用独立 `activityQuestions` 集合，一问最多一个回答。提问事务必须同时读取活动文档并重验下架、截止和 `RECRUITING | FORMED` 状态；回答事务必须重验发起者权限和 `RECRUITING | FORMED | IN_PROGRESS` 状态。问题/回答与对应审计日志必须在同一事务内提交。

## 数据与隐私

- 公开 DTO 不得包含 `contactInfo`、完整 openid、内部风控字段或运营备注。
- 公开问答 DTO 只输出问题、回答、昵称快照和公开时间，不得包含 `askerId`、`responderId`、openid、联系方式、幂等 hash 或内容审核内部字段。
- 通知 DTO 只输出显式字段白名单，目标使用由通知类型计算的 `MANAGE | GROUP | DETAIL` 语义枚举；不得透传数据库中的自由 `url` 或 `page` 字段。未来微信服务通知的 `page` 也必须由同一类型映射纯函数生成。
- 地点只存城市、行政区、商圈/地标标签和成团后说明；MVP 不存经纬度。
- 拼车费用只允许 `FREE | SHARED_COST | NO_COST`，禁止自定义收费金额。
- 日志不得记录完整联系方式、微信凭据或用户提交的敏感原文。
- 公开活动列表的 `nextCursor` 是客户端不可解释的不透明字符串；当前 raw-offset 实现必须在服务入口校验非负十进制安全整数，并在 keyword、截止状态等后置过滤场景中扫描 `limit + 1` 个匹配项，以下一个匹配项的原始偏移作为续页游标。
- CloudBase 公开列表不得先截一页再执行 keyword 或截止过滤；应分批扫描并设置明确的原始候选上限。`RECRUITING` 且报名截止时间不晚于服务端当前时间的活动在 list/detail 读时视为 `EXPIRED`，读取不得原地修改持久化实体。

## 内容安全与错误

- 标题、描述、申请说明、取消原因和举报文本在写入前经过统一 Moderation 端口。
- 公开问题和回答也是 UGC，必须在写入事务前同步通过同一 Moderation 端口；`SUSPENDED` 活动优先收敛为 `TAKEDOWN`，不得被内容安全错误覆盖。
- 微信内容安全未配置或不可用时，开发/演示环境使用明确的本地策略；生产环境不得静默放行。
- 对外错误使用稳定错误码和安全文案，不返回数据库、SDK 或堆栈原文。
- `SUSPENDED` 活动不进入公开列表，直达详情统一返回 `TAKEDOWN`；公开响应不得包含处置原因或管理员标识。

## 测试

- 使用 Node 内置 `node:test`，不依赖第三方测试框架。
- 必测：状态转换、幂等、重复申请、最后名额并发、越权、联系信息隔离、取消/退出、内容拒绝。
- 对 SDK 限制增加静态回归检查，例如禁止 CloudBase 事务回调中出现 `where()`。
