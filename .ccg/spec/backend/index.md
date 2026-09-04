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
- 原成员私信 `MEMBER_DM` 只能由 `activityId + memberId` 业务关系创建；服务端现场校验调用者与目标均为同一 `FORMED | IN_PROGRESS` 活动的有效成员，不接受裸用户 ID 作为建会话依据，不向客户端暴露对方内部用户 ID。发起人咨询 `OWNER_CONSULT` 只接受 `activityId`，目标必须由服务端读取活动 `ownerId` 派生，不能复用客户端提交的目标身份。
- 运营动作必须显式检查角色；不得依赖前端隐藏按钮。

## 状态与并发

- 活动状态：`DRAFT | RECRUITING | FORMED | IN_PROGRESS | COMPLETED | CANCELLED | EXPIRED | SUSPENDED`。
- 非拼车活动继续使用 `PENDING | APPROVED | REJECTED | WITHDRAWN | LEFT | EXPIRED | CANCELLED_BY_ACTIVITY` 申请流；澳门拼车使用 `ride.join` 直接入团，不经过发起者审批。
- `ride.join` 必须在 Store 事务边界内检查报名截止、容量、重复成员和同一行程司机/乘客身份冲突；使用确定性 member ID，重复调用不得重复占位，`LEFT` 成员可在仍有名额时恢复为 `ACTIVE`。
- 达到目标人数自动成团。任何时刻有效成员数不得超过 `targetMembers`。
- 所有写动作接收幂等键；状态转换必须校验源状态并写审计记录。
- 私信消息 ID 必须由服务端身份与客户端 `clientMessageId` 确定性派生，同 ID 同正文幂等返回，同 ID 不同正文返回 `CONFLICT`。消息、会话预览与收件人未读增量必须在同一事务中提交。
- 成员群聊以活动单调递增 `groupSequence` 定义历史顺序；成员每次转为 `ACTIVE` 时在同一事务记录新的 `groupWindow { generation, after }`，只允许读取 `sequence > after` 的本周期消息。退出立即禁读写，重新加入必须增加 generation 且不得恢复上次周期历史；列表、摘要、未读、消息 ID 读取、已读和幂等重放必须共享同一可见性判断。缺失或损坏边界一律 fail-closed。
- 群消息 ID 必须绑定活动、服务端 actor、成员 ID、成员 generation 与客户端消息 ID；事务内重新校验成员周期并分配序号。`RECRUITING | FORMED | IN_PROGRESS` 可写，终态当前成员只读，`SUSPENDED` 禁止读写。
- `OWNER_CONSULT` 只在 `RECRUITING | FORMED | IN_PROGRESS` 可创建和发送，终态双方只读；下架活动从咨询列表、未读、历史读取和幂等重放全部隐藏或拒绝。旧无 kind 会话按 `MEMBER_DM` 处理，不能借咨询分支放宽。
- 私信历史可在共同活动结束后只读查看，但新消息只能在关联活动仍为 `FORMED | IN_PROGRESS` 时发送。未读数只为收件人累加，且只有会话参与者可清除自己的未读。
- 私信可发送 DTO 必须同时检查活动、双方 ACTIVE 成员事实和双方 ACTIVE 账号；新建会话与新消息事务内重验同一条件。条件已读仅以调用方实际拉取的最新消息 ID 与会话最新 ID 精确相等时清零。未读汇总按不可变 ID 分页扫描双方参与字段，不得用每侧固定 100 条截断总数。
- CloudBase 文档数据库事务内只使用 `transaction.collection(...).doc(id)`；不要在事务内调用 `where()`。需要跨实体唯一性时使用由业务自然键派生的确定性文档 ID。
- 社区点赞以 `targetType + targetId + actorId` 派生确定性文档 ID，帖子/回复计数、点赞状态和审计必须在同一事务内更新；重复设置同一状态不得重复增减计数。回复点赞还必须在事务内确认所属帖子仍为 `ACTIVE`，点赞状态批量读取按不超过 10 个 ID 分片。
- CloudBase 事务中的 `doc(id).get()` 在文档不存在时可能直接抛出 `-502005`，Store 边界只可将该明确错误归一化为“未找到”，其他事务错误必须继续抛出；对可能为 `null` 的对象字段不得使用嵌套路径更新，应在事务中读取并整字段替换。
- 事务后批量补偿动作必须可重复执行；即使主实体已经到达最终状态，重试仍需重新检查并补齐未完成的关联状态。
- 活动公开问答使用独立 `activityQuestions` 集合，一问最多一个回答。提问事务必须同时读取活动文档并重验下架、截止和 `RECRUITING | FORMED` 状态；回答事务必须重验发起者权限和 `RECRUITING | FORMED | IN_PROGRESS` 状态。问题/回答与对应审计日志必须在同一事务内提交。
- 拼车司机履约以独立 `rideFulfillments` 集合/Map 为事实源，`activities.rideFulfillment` 与 `rideJoinable` 只作为缓存。详情、列表、我的、直接入团和退出等所有权限或可见性判断必须先水合事实源；缺失 fulfillment 一律 fail-closed。CloudBase 的 `command.in` ID 查询按不超过 10 个值分片。
- 司机已确认承接后，MVP 不允许乘客自行退团，以避免 `RECRUITING + ASSIGNED` 跨集合矛盾状态；未来若开放，必须在同一事务中同步解除司机承接并重新计算活动状态。
- 服务端 DTO 必须明确返回 `canJoinRide`、`canLeaveRide` 与 `rideExitLocked`。`canJoinRide` 为 false 时同时返回稳定、脱敏的 `joinUnavailableReason`，不让客户端自行推导权限原因。司机承接只锁定已有成员的退出权限；若报名仍开放且未满 7 人，新乘客仍可直接加入。同一用户不得在同一行程同时成为有效乘客与承接司机。
- 澳门校园拼车固定为 7 个乘客名额，司机不计入乘客人数；活动只有在有效乘客数达到 7 时进入 `FORMED`，不得再读取或接受客户端自定义成团人数。
- 澳门拼车成员行李使用成员级 `luggageType: NONE | SMALL | LARGE`，不得再把活动级旧字段 `typeData.luggageRule` 写入或映射为个人行李。发起者创建行程与乘客直接入团都必须显式选择且在 API、Store 两层校验；重复加入中的 `ACTIVE` 成员不得被新请求静默改写，`LEFT` 成员重新加入时使用本次选择覆盖旧值。旧成员缺失该字段时保持 `null/未填写`，不得默认成“无行李”。
- 司机承接资格与乘客成团状态解耦：只要行程未取消、未下架、未被其他司机承接且服务端当前时间早于接车时间窗上限，审核通过的司机即可承接。报名截止只关闭乘客申请，不得提前关闭司机承接；司机确认后，未满 7 人且仍在报名期内的乘客通道继续开放。
- 接车时间窗上限代表该趟未承接行程已经错过实际出发机会：未分配司机的行程到达该上限后整体读时归一化为 `EXPIRED`。这不等于用司机截止替代报名截止；正常数据必须满足报名截止早于接车时间窗，乘客申请仍先由报名截止关闭。
- 拼车联系方式除了要求活动状态为 `FORMED | IN_PROGRESS | COMPLETED`，还必须从 `members` 事实源现场统计 `ACTIVE` 成员不少于 7；不得只信任 `activities.memberCount` 聚合字段，防止旧数据或补偿漂移提前解锁。
- 澳门 MVP 的司机可选接车时间窗固定为 60 分钟，创建校验与承接事务都必须重验这一长度，并要求 15 分钟档位落在 `[startsAt, pickupWindowEnd)`；在产品规则正式变更前不得把它放宽为任意窗口。

## 数据与隐私

- 三类新活动头像名册只公开受控 kind，不公开内部 memberId；创建、批准、退出在同一存储事务更新名册，资料同步同时更新活动 updatedAt。名册缺失不按人数伪造头像。历史 ride 只读 DTO 必须在公开转换入口归一七人容量，包括 Mock 的聚合页直接入口，不依赖 list/detail 上游预处理。

- 公开 DTO 不得包含 `contactInfo`、完整 openid、内部风控字段或运营备注。
- 公开列表与游客详情不得暴露成员个人行李；只可在当前用户自己的 `viewerMembership` 或经授权的成团/管理成员视图中按需返回。
- 公开问答 DTO 只输出问题、回答、昵称快照和公开时间，不得包含 `askerId`、`responderId`、openid、联系方式、幂等 hash 或内容审核内部字段。
- 通知 DTO 只输出显式字段白名单，目标使用由通知类型计算的 `MANAGE | GROUP | DETAIL` 语义枚举；不得透传数据库中的自由 `url` 或 `page` 字段。未来微信服务通知的 `page` 也必须由同一类型映射纯函数生成。
- 地点只存城市、行政区、商圈/地标标签和成团后说明；MVP 不存经纬度。
- 拼车费用只允许 `FREE | SHARED_COST | NO_COST`，禁止自定义收费金额。
- 日志不得记录完整联系方式、微信凭据或用户提交的敏感原文。
- 公开活动列表的 `nextCursor` 是客户端不可解释的不透明字符串；当前 raw-offset 实现必须在服务入口校验非负十进制安全整数，并在 keyword、截止状态等后置过滤场景中扫描 `limit + 1` 个匹配项，以下一个匹配项的原始偏移作为续页游标。
- CloudBase 公开列表不得先截一页再执行 keyword 或截止过滤；应分批扫描并设置明确的原始候选上限。非拼车活动在 `RECRUITING` 且报名截止时间不晚于服务端当前时间时，于 list/detail 读时视为 `EXPIRED`；澳门拼车在报名截止后只关闭乘客申请，并持续向司机视角暴露至接车时间窗上限。读取不得原地修改持久化实体。
- 使用 `createdAt + _id` 排序的游标分页必须把两个字段编码为同一个不透明游标，并在 CloudBase 查询层用复合边界表达式处理同时间戳记录；不得用固定数量的额外扫描项猜测同时间戳规模。Memory、Mock 与 Cloud 实现必须共享游标语义和排序方向。
- 社区公开 DTO 的点赞信息只允许输出非负 `likeCount` 与当前调用者的 `viewerHasLiked`；游客固定为 `false`，不得暴露点赞用户列表或内部 actor ID。
- 澳门拼车发现页的 `campusId` 只允许 `TAIPA_CAMPUS | GOLDEN_DRAGON_CAMPUS`；校区匹配包含以该校区为起点或终点的固定路线，并且必须在数据库/Store 候选查询层、分页截断之前执行。`routeId` 继续保留用于发布、详情和兼容调用。
- 司机身份意向不得授予承接权限；只有审核通过后物化的 `drivers` 与 `vehicles` 事实记录可以授权承接。
- 司机证件上传必须使用本人、资料类型和 TTL 绑定的 staging 槽；云函数校验文件类型与大小后迁移到客户端不可覆盖的随机 sealed 路径。申请只能引用已检查的 uploadId，客户端不得持有或提交 sealed 文件地址。
- 完整证件号、驾驶证号、车牌和 sealed 文件引用只进入加密敏感集合；公开 DTO 仅输出脱敏摘要。撤回、驳回或要求补资料后标记 `RETENTION_PENDING`，生产环境必须有实际到期删除任务。
- 澳门拼车成员电话必须存入独立 `memberContacts` 集合，并以活动与成员自然键派生确定性文档 ID；不得写入 `activities`、公开 DTO、审计明文、日志或客户端持久化。发布者创建与乘客直接入团必须和成员、活动变更处于同一事务边界；成员退出时联系人同步转为 `INACTIVE`，`LEFT` 重入时才允许覆盖。
- 成员电话名单只允许 `rideFulfillments` 当前 `ASSIGNED` 的 `driverId` 读取，并只返回 `ACTIVE` 成员的昵称、电话、行李与角色。动态名单读取完成后必须再次实时复核 fulfillment；取消或改派后原司机立即失权。任一有效成员联系人缺失时整体返回 `CONTACT_INCOMPLETE`，不得部分泄露或猜测旧活动联系方式。
- 生产司机审核默认关闭；开发审核入口只允许在环境被明确标记为 `development | test` 且开关显式开启时使用。
- 开发环境若启用司机认证自动通过，必须同时满足 `PINBA_ENV=development|test` 与显式开发审核开关；新申请、加密敏感记录、上传绑定、司机、车辆和审计必须在同一事务落定。生产环境及旧 `SUBMITTED` 申请不得被隐式自动批准。
- 平台面向已完成基础资料与成年确认的普通用户开放。`activity.create` 与 `application.submit` 必须要求活跃账号、完整资料及 `adultConfirmed === true`；`activity.mine`、通知和成员空间要求活跃登录账号，但不得再读取学生认证事实或学校资料。
- 已下线的学生认证、学生证件上传与后台审核动作必须统一进入 `REMOVED_ACTIONS` 并返回 `NOT_FOUND`；运行时 Store 不得继续声明或访问学生认证集合。历史敏感集合只允许通过独立的数据治理流程归档或删除，不得重新暴露到业务接口。
- 取消学生认证门禁不得弱化登录、账号状态、成年确认、成员关系与资源归属校验；公开发现/详情继续允许游客只读浏览，写操作仍按最小权限 fail-closed。

## 内容安全与错误

- 标题、描述、申请说明、取消原因和举报文本在写入前经过统一 Moderation 端口。
- 私信正文同样是 UGC，必须在入库前经过 Moderation，并在 MVP 阶段拒绝外链、邮箱、电话和社交账号导流内容；会话可进入统一举报契约。
- 公开问题和回答也是 UGC，必须在写入事务前同步通过同一 Moderation 端口；`SUSPENDED` 活动优先收敛为 `TAKEDOWN`，不得被内容安全错误覆盖。
- 微信内容安全未配置或不可用时，开发/演示环境使用明确的本地策略；生产环境不得静默放行。
- 对外错误使用稳定错误码和安全文案，不返回数据库、SDK 或堆栈原文。
- `SUSPENDED` 活动不进入公开列表，直达详情统一返回 `TAKEDOWN`；公开响应不得包含处置原因或管理员标识。

## 测试

- 使用 Node 内置 `node:test`，不依赖第三方测试框架。
- 必测：状态转换、幂等、重复申请、最后名额并发、越权、联系信息隔离、取消/退出、内容拒绝。
- 对 SDK 限制增加静态回归检查，例如禁止 CloudBase 事务回调中出现 `where()`。
