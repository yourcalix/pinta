# Diagnostic Result

云函数日志明确返回 `-502005 database collection not exists`，缺失集合为 `communityLikes`。`community.post.detail` 在登录态读取帖子及回复后会查询当前用户的点赞状态，因此集合缺失会被安全归一为 `INTERNAL`，对应客户端“讨论暂时无法查看”错误态。

最小处理是在当前 CloudBase 环境创建大小写完全一致的 `communityLikes` 集合，权限设为所有用户不可读写，仅允许云函数服务端访问。无需初始文档、无需额外索引，也无需修改代码或界面。
