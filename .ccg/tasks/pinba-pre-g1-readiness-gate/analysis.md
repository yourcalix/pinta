# 拼吧 G1 前置门禁 CCG 综合分析

## 当前事实

- 公共 `project.config.json` 仍为 `touristappid`。
- `project.private.config.json` 当前缺失，但已被 Git 忽略且未被跟踪。
- `useMock=true`、`cloudEnv=''`、`subscribeTemplateIds=[]`，尚未误入 G1。
- G0 代码、自动化、Spark 和网页版 Gemini 复核已完成；真实 AppID 后台与 iOS/Android 证据尚未完成。

## Spark 分析

GPT 5.3 Codex Spark（SESSION_ID `01a02d91-8a3e-7621-9b2c-ae31c789539f`）建议采用“自动基础门禁 + 人工证据门禁”：

- 自动检查公共/私有配置、Git 隔离、Mock 基线和 AppID 形态，但绝不输出 AppID。
- 账号成员、服务类目、隐私指引和 iOS/Android 真机链路必须由人工证据确认，脚本不得自动宣称通过。
- G1 前只要求测试 CloudBase 环境已创建；生产环境留作上线前硬门槛。
- 内容安全负责人/申请入口需要备案，生产启用留到 G1；订阅模板已提交即可，审批结果不阻断进入 G1。
- 建议退出码：`0=PASS`、`3=MANUAL`、`1=BLOCKED/校验失败`。

## Gemini 前端输入

本任务不修改 WXML/WXSS 或页面交互，直接承接用户上一轮贴回的网页版 Gemini 3.6 真机矩阵：iOS 首次授权、协议半屏、原生 Toast、10 秒内重复拒绝；Android Safe Area、长按选择和大字号均必须在真实 AppID/真实设备记录证据。

## 主会话综合决策

1. 新增只读 `scripts/g1-readiness-gate.js`，不写配置、不联网、不登录、不探测生产资源。
2. 新增私有人工证据文件 `g1-readiness.manual.json`，仓库只提交无个人信息的 example，真实文件加入 `.gitignore`。
3. 缺失/无效真实 AppID 是自动 `BLOCKED`，而不是可被文字勾选绕过的 MANUAL；当前门禁预期为 BLOCKED。
4. 阻断性人工项只有在 `PASS + checkedAt + checkedBy + evidence[]` 齐全时才通过；缺失为 MANUAL，明确 FAIL 为 BLOCKED。
5. 非阻断建议项可以保持 PENDING，不影响最终 PASS，但必须在报告中列为 advisory。
6. G1 唯一入口：自动阻断项为零、所有阻断人工项有结构化证据；脚本结果为 PASS。
