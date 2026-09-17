# 需求与接入约束

## 目标

- 使用 `/Users/cx/Downloads/loading-advanced-wechat/` 中的 WXML/WXSS/JS 为视觉与动效基准。
- 使用 `/Users/cx/Downloads/loading-assets/` 中的猫、狗、装饰、空轨道和绿色填充五张透明 PNG。
- 保留澳门手绘插画作为全屏静态背景，猫狗与纸纹进度动画叠加在下方安全区。

## 现有生命周期必须保留

- 当前 App Session 只展示一次。
- 首屏真实数据就绪且达到最短展示时间后才进入完成动画。
- 4500ms 硬超时直接交还页面真实加载态。
- 任一关键素材失败时立即关闭启动层。
- 页面隐藏、卸载、超时或正常完成时，必须清理页面与组件计时器并恢复自定义 TabBar。

## 适配原则

- 源 `Page` 演示代码不可原样复制；改写为现有 `launch-splash` Component 的内部动画状态。
- 演示用 `runDemoLoading()` 不进入生产；进度最高自然缓行至 86%，只有真实首屏就绪才允许进入 100% 完成态。
- 最短展示收敛为 900ms；正常完成时先执行 380ms 冲刺/填满动画，再执行 240ms 整层淡出。
- 真实数据在 3800ms 之后才就绪时跳过冲刺，直接淡出；4500ms 到达时仍无条件卸载。
- 不使用原生 `disabled`、第三方动画库或 `wx.hideTabBar/showTabBar`。
- 内部图片全部退出触控和无障碍树，根节点统一提供加载语义。
- 背景图与 5 张动画图片必须全部 `bindload` 成功才启动跃动和缓行；任一 `binderror` 只上报一次并立即退出。
- 活动中的全屏宿主继续阻断底层页面交互，不使用 `pointer-events: none`；仅在淡出态解除拦截。

## 体积与素材

- 当前主包仅约 8.2KiB 余量，旧启动 JPEG 为 129,795 bytes。
- 背景图须重压为约 50KiB，五张动画素材约 72KiB；六张素材合计必须保持在约 130KiB 以内，不放宽 1.71MiB 主包预算。
- 按真实显示尺寸降采样：猫/狗约 280×280，横向素材约 520×260；使用优化的调色板 PNG 保留 Alpha。
- 预压缩验证五张素材合计约 72KiB，视觉轮廓和纸质纹理保留正常。

## 预计修改范围

- `miniprogram/components/launch-splash/index.js`
- `miniprogram/components/launch-splash/index.wxml`
- `miniprogram/components/launch-splash/index.wxss`
- `miniprogram/pages/discover/index.js`
- `miniprogram/pages/discover/index.wxml`
- `miniprogram/utils/launch-splash-timing.js`
- `miniprogram/assets/images/launch/`
- `tests/launch-splash.test.js`
- `.ccg/spec/frontend/index.md`
