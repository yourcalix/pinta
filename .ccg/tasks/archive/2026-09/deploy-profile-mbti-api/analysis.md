# GPT-5.5 部署分析摘要

- 必须显式指定 AppID `wxac9db09a9dda5726` 与唯一环境 `cloud1-d0giupmx3ce04ddd0`。
- 以当前 HEAD 中与 `5c03ce7` 一致的 `cloudfunctions/api` 为部署来源，临时任务记录不能进入部署包。
- 使用平铺 bundle 作为唯一部署与下载比对基准。
- 部署后必须确认函数仍为 Active、运行时和超时未漂移，并逐字节核对线上下载包。
- 不通过真实用户写入验证，不读取业务集合。

