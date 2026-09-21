# 活动进程 IP 卡片审查记录

## 自动化验证

- `node --test tests/leju-progress-card.test.js`：9/9 通过。
- `npm run verify`：599 项测试，598 通过、0 失败、1 项既有环境跳过；项目结构检查通过。
- `git diff --check`：通过。
- 六张拼好饭卡均为 900×1125 Baseline JPEG，保持原图比例，总体积约 1.06MiB。
- 活动分包源码约 1.217MiB，低于 1.50MiB 门禁。

## GPT-5.5 契约复审

### 已修正

1. resolver 不再接受前端遗留 `product` 类型，只接受服务端归一后的 `food`，避免类型误配。
2. 申请登录失败或未真正打开申请抽屉时，恢复被暂停的进程卡调度。
3. 损坏缓存的 `updatedAt` 在容量裁剪时按最旧记录处理。
4. `highestSeenRank` 与候选同级时也阻止重复展示，增强损坏/旧缓存防御。
5. 补充对应自动化回归测试。

## 网页版 Gemini 3.7 Flash 前端复审

- Verdict：`APPROVE`。
- Critical：无。
- Warning：活动分包约 1.217MiB，后续继续加入大图时需提前预警。
- 处理：在既有包体测试中增加 activity 分包 1.35MiB 安全门禁；1.50MiB 仍为最终硬上限。
- Info：认可 Baseline JPEG 选择、短屏 62vw 几何收敛、图片门禁、seen/snooze 高水位与浮层互斥方案。
