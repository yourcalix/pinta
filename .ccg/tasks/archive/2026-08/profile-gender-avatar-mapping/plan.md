# 实施计划

1. 新增后端 `MALE | FEMALE` 与 `PASSENGER_A | PASSENGER_B | EMPTY` 白名单和纯函数映射。
2. 资料更新强制选择性别；历史资料可读取但 `profileComplete=false`，仅拼车发布/加入被阻断。
3. 拼车活动内部维护最多 7 人的 `avatarRoster`（包含内部 memberId 与 avatarKind）；公开 DTO 仅输出定长 `avatarSlots.kind`。
4. 创建、直接加入、退出在现有事务内同步更新成员 avatarKind 与活动头像名册；资料性别变更补偿同步当前 ACTIVE 成员。
5. Mock、Memory 与 Cloud Store 对齐；历史缺失头像统一降级为空位，不依据昵称或索引猜测。
6. 资料页增加无默认值的男女单选卡；“我的”页按本人 gender 映射 A/B/Empty；活动卡消费服务端头像槽位并适配 7 人窄屏布局。
7. 新增自动化测试并运行全量验证；随后执行 GPT-5.5 后端复审与网页版 Gemini 3.7 Flash 前端复审。
