# 修复审查

## 根因与生产状态

- 根因：目标 CloudBase 环境缺少 `profileFollows` 集合。
- 已创建集合并重新部署当前 `api` 云函数。
- 真实账号关注与取消关注均通过，最终状态恢复为未关注、粉丝数 0。
- 当前访问模式为确定性文档 `_id` 精确读写，不需要新增索引。

## 代码审查

### Critical

无。

### Warning

1. 新环境仍需显式创建 `profileFollows`。已在 README 与后端 Spec 中加入权威集合列表/真实读取校验要求。
2. 顺序读取的静态测试对源码格式较敏感。当前作为短期回归锁保留；未来抽取事务读取工具时改为语义化调用顺序测试。

### Info

- 保留事务内顺序读取，避免 CloudBase SDK 并发文档读兼容风险。
- 关系写入、双方计数与审计仍处于同一事务边界。
- 幂等规则未改变，重复设置同一关注状态不会重复增减计数。

## 验证

- `node --test tests/profile-followers.test.js`：8/8 pass。
- `npm run verify`：578 total，577 pass，1 skip，0 fail。
- GPT-5.5 后端审查：通过，无 Critical。
