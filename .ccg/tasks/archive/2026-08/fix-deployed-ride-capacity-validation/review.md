# 云端拼车人数校验热修复复核

## 根因

本地发布表单与 `cloudfunctions/api` 已统一使用固定 7 名乘客，但目标 CloudBase 开发环境中的 `api` 云函数仍为旧版本，因此返回“最低成团人数必须在2到4之间”。

## 执行结果

- 目标环境：`cloud1-d0giupmx3ce04ddd0`
- 目标函数：`api`
- 完整目录部署受当前微信开发者工具 CLI `EISDIR` 打包缺陷阻断。
- 使用 esbuild 将本地入口及 `lib` 模块临时打包为单文件，`wx-server-sdk` 保持 external，并由云端依据原 `package.json` 安装。
- 官方部署命令返回：`success=true`、`filesCount=3`、`packSize=26.6KB`。
- 部署包静态核验：`RIDE_MIN_PASSENGERS=7`、`RIDE_MAX_PASSENGERS=7`，ride 校验上下界引用该常量。
- 部署后函数状态：`Active`。
- 数据库未执行删除、覆盖、迁移或写入操作。
- 临时部署目录已删除。

## 验证

- 本地全量测试：179/179 通过。
- 未发现 `__dirname`、动态 `require` 或运行时本地文件读取，单文件打包未改变当前运行契约。
- `wx-server-sdk` 已在 `dependencies` 中声明为 `^4.0.2`。

## GPT-5.5 审查

- Critical：无。
- Warning：单文件部署需确保 SDK 依赖声明，并避免动态目录读取；两项均已核验满足。
- 最终结论：可交付。

## 剩余人工验证

在 iPhone 真机重新发布一条拼车活动，确认不再出现旧的“2到4人”校验提示。
