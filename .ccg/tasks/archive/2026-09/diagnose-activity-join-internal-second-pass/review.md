# 审查结果

## 结论

APPROVE。

## 根因

`CloudStore.createApplication` 在首次申请事务中直接读取尚不存在的稳定申请文档和成员文档。真实 CloudBase 的事务 `doc(id).get()` 会对缺失文档抛出 `-502005`，该 SDK 异常随后被安全错误出口映射为 `INTERNAL`。原测试替身返回 `{ data: null }`，因此遗漏了真机故障。

## 修复

- 两处允许缺失的事务读取统一改为 `getTransactionDocument`。
- 只归一化明确的文档不存在错误；其他数据库故障继续外抛。
- 事务范围、稳定 ID、容量/截止校验、重复申请、幂等与审核制不变。

## 验证

- 新增严格 CloudBase 测试替身，缺失事务文档真实抛 `-502005`。
- 覆盖首次申请、同 key 幂等、不同 key 重复申请、已有 ACTIVE 成员和其他数据库错误外抛。
- `npm run verify`：607 项，606 通过，1 项既有跳过；项目检查通过。
- GPT-5.5 分析与代码复审均为 APPROVE，无 Critical/Warning。
- `api` 云函数已重新部署并回读为 Active。
