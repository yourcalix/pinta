# 猫狗品牌弹窗接入计划

## 1. 资源与公共组件

- 将八张插画压缩为 240×240px、128 色透明 PNG，统一放入主包 `assets/images/brand-modal/`。
- 建立主包公共组件 `components/pinba-modal/`，支持八类映射、image 覆盖、confirm/cancel/close/closed、loading、防穿透、关闭动画与安全区。
- 在不改变视觉用途的前提下压缩主包既有大图，确保 package budget 继续通过。

## 2. 发布表单

- 统一 modal 状态，冻结发布 payload/submissionKey。
- 发布成功后清理草稿并显示 success；点击去看看、退场完成后单次跳转。
- 仅可重试的传输异常显示 network；重试复用冻结请求且不重复订阅授权。
- 成功后抑制 hide/unload 草稿回写。

## 3. 社区删除

- 主列表和详情页保留 action sheet，只将二次确认换成 pinba-modal。
- 用 Promise resolver 与原动作锁桥接；取消、关闭、页面卸载均安全结算。
- 删除 pending 展示 loading；保留帖子 tombstone、回复计数和 replyTarget 校准。

## 4. 附近定位

- 用户主动点击后先检查 getSetting；曾拒绝时显示 location modal。
- 确认复用 openSetting；取消不继续定位；首次未决定仍走原生 getLocation 请求。
- 系统定位不可用继续使用现有错误态，不误判为授权拒绝。

## 5. 测试与交付

- 添加组件契约、业务状态机、资源体积与路径测试。
- 运行专项测试、全量测试、静态检查和包体预算。
- 复查 diff，执行前端 Gemini 复审；修复 Critical 后归档任务并提交、推送 main。
