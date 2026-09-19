# 讨论详情点赞红心左侧裁剪修复

## 结论

- 根因是激活心形 `scale(1.1)` 后向左超出首个 Flex 子项约 `1.8rpx`，iOS 微信原生按钮边界会裁掉这部分字形。
- 主帖与回复点赞按钮均保留原固定宽度、`88rpx` 触控高度、`36rpx` 心形槽位及数字槽位，仅增加 `4rpx` 左侧安全空间并显式设置 `overflow: visible`。
- 点赞业务逻辑、乐观更新、回滚、数字颜色和按压缩放均未修改。

## 验证

- `node --test tests/community-detail-like-stability.test.js tests/community-detail-reference-design.test.js`：5 项通过。
- `npm test`：590 项，589 通过，1 项既有跳过，0 失败。
- `npm run check`：项目结构检查通过。
- `git diff --check`：通过。
