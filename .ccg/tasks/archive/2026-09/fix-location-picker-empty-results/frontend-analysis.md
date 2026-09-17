# Gemini 3.7 Flash 方案分析

- Critical：运行环境判定存在漏洞，微信宿主可能因 `process` polyfill 被误识别为 Node。
- Warning：Key 缺失、网络失败、API 失败、候选坐标不可用与真实零结果必须分流。
- 赞同以微信宿主能力为正向判定条件，并保持纯 Node 测试隔离。
- 赞同为可恢复的搜索错误提供“重新加载”入口。
- Verdict：APPROVE_PLAN。
