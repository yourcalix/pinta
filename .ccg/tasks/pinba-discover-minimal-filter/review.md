# 发现页最小筛选复审

## Web Gemini 3.7 Flash

- 初次复审：Critical 无。
- Warning 1：清除筛选按钮在 Picker 右侧条件插入会导致 Picker 宽度跳变。
- Warning 2：`aria-role` 与 `aria-label` 挂在原生 Picker 上可能在 Android 产生双重朗读。
- 已修复：清除筛选移动到列表标题元信息区；区域 Picker 始终保持整行稳定宽度。
- 已修复：无障碍按钮语义移动到实际 `district-picker-trigger` 节点。
- 修复后最终复审：原 W-1 与 W-2 均已彻底修复；320px 与大字号布局安全可控。
- 最终分级：Critical 无、Warning 无、Info 无。
- 最终结论：【可交付】。

## GPT 5.5

- 按 CCG 路由累计发起六次后端复审。
- 第一次被 MCP 服务握手超时阻塞；第二次通过无插件临时入口排除 MCP 后，远端模型接口仍持续超时，均未返回审查正文。
- 第三次保持无插件、只读、极小范围，仍在远端模型刷新阶段持续超时，未返回正文。
- 用户要求重试后，第四次重新授予状态目录与网络权限并使用同一无插件极小范围；结果仍为模型刷新超时及 `chatgpt.com` 事件请求失败，未返回正文。
- 2026-08-27 用户再次要求重试：代理出口探测仍返回 Cloudflare `403 challenge`；第五次实际模型请求继续报模型刷新超时及 `chatgpt.com/backend-api/codex` 请求失败，未返回正文。
- 用户切换代理节点后再次探测仍为 Cloudflare `403 challenge`，出口区域特征未变化；第六次实际模型请求仍报相同模型刷新超时及 backend-api 请求失败，未返回正文。
- 不将外部通道失败计为审查通过，需由用户决定是否接受证据化主会话审查，或暂停等待 GPT 5.5 通道恢复。

### 通道恢复后的正式审查

- GPT 5.5 首轮正式审查发现两个 Warning：Mock 公开列表泄露当前演示身份视角；Mock 筛选错误缺少与真实 Service 一致的 `details.field`。
- 已修复公开列表匿名 DTO，并补齐 Mock 错误详情结构。
- 已增加 keyword 对象/数组/超长、负向 AND、匿名 guest DTO、Mock/真实错误详情一致性测试。
- GPT 5.5 修复复审：Critical 无、Warning 无；最终结论【可交付】。

## 临时模型路由

- 2026-08-27 用户明确要求后端审查模型暂时改用 GPT 5.4。
- 后续通过相同 `gpt55` 后端入口显式指定 `--gpt-model gpt-5.4`，仅替换模型，不改变 reviewer 角色、只读范围和 CCG 审查格式。
- GPT 5.4 实际请求仍在模型刷新阶段超时，并持续无法访问 `chatgpt.com/backend-api/codex`；未返回审查正文，证明当前阻塞与 GPT 5.5 模型版本无关。

## 主会话证据化审查

- API 边界对 type/city/district/keyword 做字符串、长度和白名单校验。
- 城市默认并锁定上海；“全上海”作为 district 会被拒绝，客户端选中时省略 district。
- Mock 与真实 Service 使用相同错误码和精确 AND 过滤语义。
- replace 不传 cursor，append 沿用不透明 cursor；既有请求序号继续阻止晚到响应覆盖。
- 新增客户端与云函数上海六区枚举一致性测试，防止两份部署边界常量漂移。

## 验证

- 最小筛选专项测试：11/11 通过。
- 全量测试：135/135 通过。
- 项目静态检查：通过（43 JSON、64 JS、14 WXML）。
