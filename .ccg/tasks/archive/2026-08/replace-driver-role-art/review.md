# 审查结果

- 使用内置图像编辑工具从用户提供的 JPG 中提取司机人物，并输出真实透明 PNG。
- 素材压缩为 384×384 RGBA PNG，约 79KB。
- 素材存放在资料分包内部，避免增加发现页公共主包素材预算。
- “我是司机”卡片已替换为竖向全身人物，并保持 `aria-hidden` 装饰语义。
- `npm test`：229/229 通过。
- `npm run check`：status=ok。
- `git diff --check`：通过。

## 最终生成提示词

Use case: background-extraction. Remove the checkerboard background from the provided voxel driver, preserve the full character exactly, center it on a square transparent canvas, keep clean alpha edges, and add no shadow, text, logo, watermark, or new objects.
