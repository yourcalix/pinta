# 部署记录

- AppID：`wxac9db09a9dda5726`
- CloudBase 环境：`cloud1-d0giupmx3ce04ddd0`（CLI 环境列表中唯一环境）
- 云函数：`api`
- 部署来源 HEAD：`649179c0f12c28b32c9a1826805ff8899e874822`
- `5c03ce7..HEAD` 在 `cloudfunctions/api` 与 `scripts` 范围内无差异。
- 使用 `scripts/bundle-cloudfunction.js` 生成临时平铺包并部署，CLI 返回 `success=true`、3 个文件、55.1 KB。
- 部署后状态：Active，timeout 15 秒，Nodejs16.13。
- 线上下载包与部署包一致：
  - `index.js` SHA-256：`04dc77a24270dc5396563f22eba7b8b87a426f126bf6c909f2f0bc3bbb913e63`
  - `config.json` SHA-256：`e3064d43b35dd627a27568d41e3e550f2636993e26d60b6354f58bdb41508a6a`
  - `package.json` SHA-256：`8408ccf79289671ef6fb8d2c0a7b7aa8d7af39c430f5b32f2fa8b9947cc1cb0c`
- 线上 bundle 已确认包含 `USER_MBTI_TYPES`、本人 DTO `mbti`、`undefined` 保留逻辑与 MBTI 校验。
- 未读取或修改任何真实业务数据。

