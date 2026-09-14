# 实施计划

1. 扩展验证与凭据工具：新增社区来源参数校验、短期随机票据生成与哈希，不改变社区公开 DTO。
2. 为 Memory/Cloud store 增加公开主页导航票据的创建与受控读取；Cloud 使用随机文档 ID 精确查找，不扫描用户集合。
3. 新增 `community.profile.nav.create`：登录后按 ACTIVE post/reply 反查作者，本人返回 `self`，他人签发短期票据。
4. 扩展 `profile.public.get`：先兼容既有在线星球 token，再识别社区短期 token；社区来源不声明在线。
5. 同步 Mock server 与前端 community service，保持 Cloud/Mock 返回契约一致。
6. 发现页及详情页把头像和昵称合并为独立 `catchtap` 作者按钮；dataset 只携带 `sourceType/sourceId`，复用纯内存 bridge。
7. 添加后端安全契约、前端事件隔离、本人/他人分流、过期/跨用户/删除内容测试。
8. 跑定向测试、完整验证、GPT‑5.5 后端审查与网页版 Gemini 前端终审；修复后归档、提交并推送。
