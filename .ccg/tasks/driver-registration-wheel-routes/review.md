# CCG 审查结论

## 前端（网页版 Gemini 3.7 Flash，用户贴回）

- 身份意向与司机权限隔离正确；待审或驳回司机仍可作为乘客使用。
- 双列 `multiSelector` 仅映射 8 条合法路线，回填、取消与列切换边界闭环。
- 高敏字段不进入 Local Storage，页面仅展示脱敏摘要；司机长表单的 320px、大字号、键盘、Safe Area 与无障碍结构可交付。
- 原建议的提交成功清空字段顺序不会造成高敏泄露；当前实现以同一次 `setData` 切换状态页并清空表单，不存在可见空表单帧。

## 后端（GPT-5.5 两轮复审）

首轮识别并已修复：

1. 客户端敏感写请求的持久化幂等键包含原始 payload。
2. 图片确认后 staging 路径仍可覆盖的 TOCTOU 风险。
3. 文件路径、内容类型、大小、TTL、owner、kind 与状态校验不足。
4. 审核同 key 不同决定缺少 payload 冲突校验。
5. 生产审核开关、Mock 业务幂等与敏感资料留存状态不完整。

最终复审结论：

- Critical：无。
- Warning：Mock 曾把序列化敏感表单直接作为 payloadHash；已改为带会话随机盐的 opaque hash，并增加回归检查。
- 生产链路只接受 uploadId；云函数校验 staging 文件后迁移到客户端未知的随机 sealed 路径，事务内执行 `PREPARED -> INSPECTED -> BOUND`，消除确认后覆盖。
- 生产审核默认关闭；只有明确 development/test 环境且显式开关开启时才允许开发审核。

## 自动化

- `npm run verify`：通过。
- Node tests：162/162 通过（最终 Mock 修复后将再次执行）。
- `node scripts/check-project.js`：通过。
- `git diff --check`：通过。

## 上线部署门禁

代码可进入真机验收，但真实生产尚不得放行，必须完成：

1. 创建并锁定司机认证相关集合，禁止客户端直接读写。
2. 配置 `private-driver/**` staging 与 `private-driver-sealed/**` 私有存储规则和 5MB 上限。
3. 配置独立高熵 `DRIVER_CREDENTIAL_SECRET`。
4. 部署 30 日到期清理任务并保留审计。
5. 更新小程序隐私保护指引，覆盖实名、驾驶证和车辆照片用途与删除渠道。
6. 真实 AppID 下完成 iOS/Android 拍照、上传、滚轮、键盘及无障碍走查。

## 结论

代码阶段【可交付进入真机验收】；生产上线阶段【仍受部署门禁阻断】。
