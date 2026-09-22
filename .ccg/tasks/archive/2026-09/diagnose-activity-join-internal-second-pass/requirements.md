# 第二轮真实环境申请加入 INTERNAL 诊断

## 现象

- 已将登录后的 viewer context 从复合查询改为确定性文档 ID 直读并部署 `api` 云函数。
- 用户真机再次申请加入他人活动，仍显示“服务暂时不可用，请稍后再试”。

## 目标

- 验证客户端实际 CloudBase 环境与部署目标一致。
- 明确 INTERNAL 发生在 `activity.detail` 身份刷新、`application.submit` 写入或其他前置链路。
- 获取脱敏 requestId/服务端错误类别并修复真实根因，不放宽权限或审核制。
