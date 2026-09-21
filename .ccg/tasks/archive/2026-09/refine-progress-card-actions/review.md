# 进程卡按钮排版审查

## 当前修改

- 图片尺寸、比例与短屏缩放规则保持不变。
- 主操作“收下卡片”调整至上方，使用居中品牌绿渐变胶囊。
- 次操作“稍后再看”调整至下方透明文字按钮。
- 两个按钮均保留不小于 88rpx 的真实触控高度。
- 短屏操作区宽度收敛为卡片宽度，避免文字与边缘挤压。

## 自动验证

- `node --test tests/leju-progress-card.test.js`：9/9 通过。
- `npm run check`：项目结构检查通过。
- `git diff --check`：通过。

## Web Gemini 3.7 Flash

- Verdict：`APPROVE`。
- Critical / Warning：无。
- 认可垂直主次操作层级、品牌绿微渐变、88rpx真实热区与320×568短屏几何余量。
- 按建议为主按钮补充显式 `aria-label="收下卡片"`；装饰星点继续保持 `aria-hidden="true"`。
