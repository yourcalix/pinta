# 实施计划

1. 扩展 `tests/leju-progress-card.test.js`
   - 增加五张拼同行卡的注册、Baseline JPEG、720×960、单张与总资源预算断言。
   - 将六张拼好饭素材断言调整为 720×900，同时验证其文件集合保持不变。
   - 增加拼同行权威状态、成员资格、类型隔离、debug-only 与缺少完成卡的测试。
   - 增加 3:4 卡片在 320×568 下不突破 82vh 的几何契约断言。

2. 泛化卡片注册表
   - 新增 `COMPANION_PROGRESS_CARDS`。
   - 保留 `MEAL_PROGRESS_CARDS` 与 `getProgressCard(stage)` 的现有调用契约。
   - `PROGRESS_CARD_REGISTRY` 同时注册 food 与 companion，sport 继续为空。
   - 三张无权威事实的同行卡固定为 `autoEligible: false`。

3. 泛化阶段解析器
   - 保留统一成员资格门禁。
   - food 映射完全保持现状。
   - companion 仅自动映射 `RECRUITING` 与 `FORMED`。
   - 普通与 debug 解析都进行 `activityType` 校验，杜绝跨类型串卡。

4. 生成受控图片资产
   - 删除重复报名素材，只生成五张唯一拼同行 JPEG。
   - 拼同行输出 720×960，拼好饭重采样为 720×900。
   - 使用 Baseline JPEG、4:2:0，并逐张调节质量使视觉清晰且单张不超过预算。
   - 保持组件的 WXML/WXSS 和页面显示尺寸完全不变。

5. 验证与审查
   - 先跑进程卡与包体专项测试，再跑 `npm run verify`。
   - 检查图片尺寸、Baseline 标记、文件集合、活动分包总大小与 git diff。
   - 生成拼图视觉抽查图，确认文字、角色面部、纸纹和边缘未出现明显压缩损伤。
   - 将前端 diff 交给网页版 Gemini 3.7 Flash 复审；若无 Critical，完成任务记录、规范回馈与归档。
