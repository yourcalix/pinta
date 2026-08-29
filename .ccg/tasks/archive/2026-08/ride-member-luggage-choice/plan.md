# 实施计划

1. 定义成员行李枚举 `NONE | SMALL | LARGE`，扩展创建与直接入团校验；旧活动级 `luggageRule` 仅保留历史读取兼容。
2. 先补自动化测试：发布必选、OWNER 落库、首次加入、ACTIVE 重放不覆盖、LEFT 重加入更新、公开 DTO 隔离、本人 DTO 回填。
3. 修改 Service、Memory Store、Cloud Store 与 Mock，使成员行李在相同事务中写入。
4. 发布页把 Picker 改为无默认选中的“我的行李”三项 Chip，并将 `luggageType` 放在创建请求顶层。
5. 详情页移除活动级“行李规则”，在直接加入卡片内增加三项必选 Chip；失败保留选择，成功后以 `viewerMembership.luggageType` 回填。
6. 运行定向测试、全量测试、语法与差异检查；按 CCG 结论复审并归档。
