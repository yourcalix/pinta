# Diagnostic Note

CloudBase 返回 `IndexOptionsConflict`，并明确指出 `postId + status + createdAt asc + _id asc` 索引已经存在。因此本次添加索引失败只是重复创建提示，不会破坏数据；需取消操作、刷新索引列表并确认既有索引状态。若状态正常，原讨论详情故障的下一项证据必须来自 `api` 云函数对应 `community.post.detail` 调用日志。
