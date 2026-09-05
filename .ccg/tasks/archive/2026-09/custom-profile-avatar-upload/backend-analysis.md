# GPT-5.5 后端分析摘要

## 推荐方案

- 将头像文件状态机与普通 `profile.update` 拆分。
- 新增 `profile.avatar.prepare`、`profile.avatar.confirm`，必要时增加 `profile.avatar.clear`。
- prepare 由服务端生成 `uploadId`、当前用户作用域下的临时 `cloudPath` 和过期时间。
- 客户端只向该路径调用 `wx.cloud.uploadFile`；confirm 只接收 `uploadId + fileID`。
- confirm 必须校验登录用户、上传记录归属、有效期以及 fileID 与签发 cloudPath 精确一致。
- 服务端下载并校验真实文件格式、体积、尺寸和图片安全结果；生产审核不可用时 fail-closed。
- 审核通过后封存到最终私有路径，并在事务中写入 `profile.avatar`。

## 数据与隐私

- 自定义头像只由 `selfUser.profile.avatar` 返回。
- 公开活动头像槽、社区作者、申请人、群成员等 DTO 不增加自定义头像 fileID。
- 性别头像继续作为未上传、上传失败或图片加载失败时的回退。
- 头像不参与资料完整度计算。

## 风险控制

- 禁止 `profile.update` 直接接受客户端传入的任意头像 fileID。
- 上传记录绑定 actor、uploadId、cloudPath、expiresAt 和状态机。
- 限制图片格式和大小，验证 magic bytes，不信任扩展名或 MIME。
- 新头像绑定成功后清理临时文件，旧头像进入 best-effort 或延迟清理。
- Mock 保持相同动作合同，但明确标记 mockOnly 且不伪装真实云上传。

## 主要实施面

- 后端：service、validation、cloud-store、memory-store、moderation。
- 客户端：api、user service、个人资料页、我的页、头像路径解析。
- 测试：归属、过期、路径不匹配、格式/体积/审核、幂等、DTO 隔离、加载失败回退及 Mock 分流。
