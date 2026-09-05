# 部署记录

- AppID：`wxac9db09a9dda5726`
- CloudBase 环境：`cloud1-d0giupmx3ce04ddd0`（CLI 只列出这一个环境）
- 云函数：`api`
- 部署前状态：Active，timeout 15 秒，Nodejs16.13
- 源码目录直接部署因微信 CLI 递归目录读取错误 `EISDIR` 失败，线上未更新。
- 使用仓库 `scripts/bundle-cloudfunction.js` 生成临时平铺包后部署成功；CLI 报告 3 个文件、52.7 KB，云端安装 npm 依赖。
- 部署后状态：Active，timeout 15 秒，Nodejs16.13
- 下载线上函数并与部署包核验：`index.js` SHA-256 完全一致；`config.json`、`package.json` 逐字节一致。
- 线上下载产物确认包含 `profile.avatar.prepare`、头像格式/体积/尺寸校验、`security.imgSecCheck` 和 `PROFILE_AVATAR_INVALID`。
- 未写入或读取业务数据，未执行真实用户头像测试。
