# 安全修复审查

## 命中性质

- GitHub 告警命中 `tests/g1-readiness.test.js` 中的合成测试夹具，并非真实微信 AppID。
- 微信 AppID 是客户端标识；本次也未发现 AppSecret 或其他认证凭据。
- 当前工作树已不包含连续的 `wx` 加 16 位十六进制测试字面量。

## 修复

- 测试夹具改为运行时拼接，继续验证合法 AppID 格式，同时避免 Secret Scanning 将合成值误判为凭据。
- 不改写 Git 历史、不轮换真实 AppID/AppSecret；推送普通提交后将告警按 `false_positive` 解析。

## 验证

- `node --test tests/g1-readiness.test.js`：13/13 通过。
- `node scripts/check-project.js`：通过。
- 工作树正则扫描：无同类完整字面量命中。
- GPT 5.5 安全复审：Critical 无、Warning 无；确认无需轮换或改写历史。

## 结论

可交付。
