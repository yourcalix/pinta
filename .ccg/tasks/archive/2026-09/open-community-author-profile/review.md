# 审查记录

## GPT-5.5 后端 / 安全审查

首轮发现：Mock 未复核来源、Mock 明文存票据、主页签发动作幂等键未绑定 payload、缺少过期票据清理说明及部分高风险测试。

已修复：

- Mock 改为哈希票据并复核来源、作者关系与回复父帖。
- 正式与 Mock 幂等缓存均绑定 `sourceType/sourceId` payload。
- README 补充新集合、禁止客户端直读及按 `expiresAt` 定期清理要求。
- 新增回复删除、父帖删除、作者变化、目标停用、跨来源幂等键及 Mock 来源删除测试。

复审结果：Critical 无，Warning 无，Verdict `Approve`。

## 网页版 Gemini 3.7 Flash 前端审查

用户已贴回真实复审结果：Critical 无，Warning 无，Verdict `APPROVE`。

复审确认作者统一热区、整卡 Hover 隔离、回复三路交互分离、纯内存短 key、社区主页去 Presence 文案、320px 窄屏与 ARIA 均已闭环。
