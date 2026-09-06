# 部署前分析

- 唯一 CloudBase 环境：`cloud1-d0giupmx3ce04ddd0`。
- 私有项目配置 AppID：`wxac9db09a9dda5726`；公共配置继续保留 `touristappid`。
- 目标函数 `api` 部署前为 Active，运行时 Nodejs16.13，超时 15 秒。
- 当前 HEAD：`c7ca3c4`，功能提交：`02c46f7`。
- GPT-5.5 结论：无 Critical，允许在显式指定项目、环境、函数和逐文件哈希回读的前提下部署。
- 不执行真实业务写操作；线上功能验证以包内容与只读能力为边界。
