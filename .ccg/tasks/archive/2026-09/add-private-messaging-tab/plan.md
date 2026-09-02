# 实施计划

## 阶段 1：数据契约与权限

1. 定义 DM action、限制、DTO 装饰函数与错误码映射。
2. MemoryStore 增加 conversations/messages 数据与原子方法。
3. CloudStore 增加同契约的数据访问实现与稳定游标分页。
4. Service 只允许根据活动成员事实创建会话；拒绝裸用户 ID 枚举与伪造 sender。
5. Mock server 实现同样的权限、幂等、分页、已读和内容限制。

## 阶段 2：前端消息能力

1. 新增 `services/direct-message.js`。
2. 新增主包 `pages/messages/index`：系统通知入口、会话列表、未读、分页及状态页。
3. 新增分包 `subpackages/message/chat/index`：历史分页、发送防重、已读与失败重试。
4. 在受保护的活动成员空间加入私信入口。

## 阶段 3：自定义 TabBar

1. `app.json` 启用 `custom: true` 并调整五栏路由顺序。
2. 新增 `custom-tab-bar` 组件，五列等分、中央拼图凸起、真实未读 Badge。
3. 五个 Tab 页面 `onShow` 同步 selected；消息事实刷新后同步 Badge。
4. 五个 Tab 页增加统一底部避让。

## 阶段 4：资产与视觉

1. 复用现有四项 Tab 图标。
2. 新增消息默认/激活图标。
3. 新增同母版的发布拼图默认/激活透明 PNG。
4. 消息页延续深蓝粗纹纸、奶油白纸片、油画棒视觉。

## 阶段 5：验证与审查

1. 新增后端越权、关系约束、幂等、已读与分页测试。
2. 新增 TabBar 顺序、选中态、Badge、320px 栅格与页面状态测试。
3. 跑完整 verify。
4. GPT-5.5 后端复审；生成 Web Gemini 前端复审 Prompt 并等待用户回贴。
5. 修复后归档任务。
