# 实施计划

1. 为测试增加“运行时零 WebP 引用”、PNG 多级 Alpha、JPEG baseline 签名、预览映射与主包预算约束。
2. 将 7 张透明 WebP 转换为带多级 Alpha 的调色板 PNG；将个人背景和共享纸纹转换为 Baseline JPEG。
3. 按依赖顺序更新头像、背景和预览工具，再更新活动卡、详情、发布与所有共享背景模板。
4. 全局搜索确保 `miniprogram` 运行时代码中没有 `.webp` 引用，删除 9 张旧 WebP。
5. 运行专项测试、全量 `npm run verify`、开发者工具 Preview 构建与包体检查。
6. 按 CCG 路由完成 GPT-5.5 与网页版 Gemini 复审，修复问题后归档并提交。

# 格式边界

- PNG 必须保留透明通道且具有多于两个 Alpha 层级，避免边缘二值化。
- JPEG 必须为 baseline，不使用 progressive。
- 个人背景继续复用已有 baseline 预览 JPEG 内容；展示路径改为新的 `.jpg` 文件名。
- 静态路径扩展名变化用于自然清除真机旧缓存，不附加 querystring。
