# 前端终审

## Gemini 3.7 Flash 结论

- Critical：无。
- Warning：真机多行 textarea 需要键盘避让；现有实现已为全部 input/textarea 配置 `adjust-position="true"` 与 `cursor-spacing="140"`。
- Info：顶部类型说明在极窄屏和大字号下应保持单行省略；已补充弹性收缩与 ellipsis。
- 三类表单可以完全共用当前动态骨架，结论为可交付。

## 主会话综合

- 采纳：类型说明单行保护。
- 已满足：自定义导航、胶囊动态避让、底部 180rpx + Safe Area、全部输入控件键盘避让、320px 单列退化与无障碍语义。
- 暂不采纳：主动 focus 滚动锚点、底栏渐变毛玻璃和震动反馈；前者可能造成键盘二次跳动，后两者不属于本轮统一视觉的必要范围。

## 验证

- 微信开发者工具真实编译并打开“发布拼同行”页面：Errors 0。
- `npm test`：145 项，143 通过、2 项旧用例跳过、0 失败。
- `npm run check`：通过。
- `git diff --check`：通过。
