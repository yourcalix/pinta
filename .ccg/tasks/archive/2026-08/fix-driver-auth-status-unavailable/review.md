# 诊断记录

- 前端运行配置为 `useMock: false`，目标环境为 `cloud1-d0giupmx3ce04ddd0`，云函数名为 `api`。
- 本地 `cloudfunctions/api/lib/service.js` 已注册 `driver.application.get` 与 `ride.driver.profile`。
- 云端函数为 Active 只能证明函数可运行，不能证明运行版本已包含当前动作契约。
- `loadDriverAuthSnapshot` 仅在两请求均明确成功为空、存在申请，或存在有效司机事实时进入 ready；接口异常继续 fail-closed 为 error，不能改成“未认证”。
- GPT-5.5 判断最高概率根因为云端旧部署/动作契约错配，建议部署最新聚合云函数并回归三类状态。

# 修复与验证

- `npm run verify` 通过：248/248 测试通过，项目静态检查通过。
- 直接部署源码目录触发微信开发者工具 CLI 已知 `EISDIR` 打包缺陷，云端未被错误覆盖。
- 使用内容等价的临时平铺副本重新部署成功；`wx-server-sdk` 继续由云端安装。
- 官方 CLI 返回 `success=true`、`filesCount=20`、`packSize=51.2 KB`。
- 部署后回读 `api`：`Active`、15 秒超时、`Nodejs16.13`。
- 未修改或删除数据库、认证资料与云函数环境变量。

# 结论

云端动作版本错配已解除。前端继续保持 fail-closed：只有两个司机认证接口明确成功为空时才展示“开始司机认证”，异常不会伪装成未认证。
