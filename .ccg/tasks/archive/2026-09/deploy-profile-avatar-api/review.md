# 部署复审

## GPT-5.5 结论

- 无 Critical，`api` 云函数代码部署完成，线上下载包与本地部署包一致，无需重新部署。
- CLI 明确使用唯一环境 `cloud1-d0giupmx3ce04ddd0`，未发生目标环境歧义。
- 平铺 bundle 是对微信 CLI 源目录 `EISDIR` 问题的合理规避方式。

## 证据

- CLI 部署结果：`success=true`、`filesCount=3`、`packSize=52.7 KB`。
- 部署后函数状态：Active，timeout 15 秒，Nodejs16.13。
- 线上 `index.js` SHA-256：`3dcb6d5497f2863851faf5b21b51caa8312b71a3db8d38362ede2472002c0ffd`，与部署包一致。
- 线上 `config.json`、`package.json` 与部署包逐字节一致。
- 下载产物确认包含 `profile.avatar.prepare`、`security.imgSecCheck`、头像格式/体积/尺寸校验。

## 尚待云环境与真机确认

- `profileAvatarUploads` 集合是否已创建并保持客户端不可直接读写。
- `private-profile-avatar-temp/**` 与 `private-profile-avatar/**` 的云存储访问策略和到期清理机制是否已在控制台落地。
- 生产环境变量是否配置为 `PINBA_ENV=production`、`ENABLE_WECHAT_CONTENT_CHECK=true`。
- 使用受控测试账号完成一次选择头像、上传、确认、回显、预览和恢复默认的真实端到端测试。

## 交付结论

云函数代码部署成功；云环境配置和真实头像端到端测试仍需在控制台/真机确认。
