# GPT-5.5 后端分析摘要

- 推荐扩展现有批量头像水合，不新增第二组查询。
- `ownerProfile` 最小公开契约：`nickname`、`avatar`、`gender`、服务端派生的整数 `age`、受控枚举 `mbti`。
- 年龄必须按澳门自然日从 `birthDate` 派生；客户端永远不得取得完整生日或出生年份。
- 缺失或非法生日返回 `age: null`，缺失 MBTI/性别返回 `null`。
- Cloud、Memory、Mock、缓存降级必须同构。
- 严禁公开完整 profile、birthDate、interests、adultConfirmed、userId、memberId 或 cloud fileID。
- 主要风险：生日与 MBTI 原先按私密资料收集，将其派生信息用于公开展示属于用途扩大，需要同步调整资料页告知或引入明确可见性选择。
