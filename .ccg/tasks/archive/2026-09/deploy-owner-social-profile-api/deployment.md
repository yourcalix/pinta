# 部署记录

- 部署时间：2026-09-06（Asia/Shanghai）。
- AppID：`wxac9db09a9dda5726`。
- CloudBase 环境：`cloud1-d0giupmx3ce04ddd0`（CLI 环境列表中唯一环境）。
- 云函数：`api`。
- 部署来源 HEAD：`c7ca3c4`；功能提交：`02c46f7`。
- 使用 `scripts/bundle-cloudfunction.js` 生成仓库外临时平铺包。
- staging 仅包含 `index.js`、`package.json`、`config.json`。
- CLI 部署报告：`success=true`、3 个文件、56.1 KB，云端安装 npm 依赖。
- 部署后状态：Active，timeout 15 秒，Nodejs16.13。

## 线上包校验

- `index.js` SHA-256：`4c0f29dfeb2f2b36e8a9381cd17690ec1b348261049872142c612ba7c5a04f84`
- `package.json` SHA-256：`8408ccf79289671ef6fb8d2c0a7b7aa8d7af39c430f5b32f2fa8b9947cc1cb0c`
- `config.json` SHA-256：`e3064d43b35dd627a27568d41e3e550f2636993e26d60b6354f58bdb41508a6a`
- 下载的线上三个文件与 staging 逐字节一致。
- 线上 bundle 已确认包含 `calculateAgeOnMacauDate`、`USER_MBTI_TYPES`、`ownerProfilesByActivity` 和 `ownerProfile` 公共 DTO 逻辑。

未读取或写入任何真实业务数据，未上传小程序版本，未部署其他云函数。
