# WorkBuddy 队列 Connector 本地自检

- 日期：2026-11-22
- 命令：`node automation开发/connectors/workbuddy-eval/selfcheck.mjs`
- 结果：`passed`，退出码 0。
- 测试类型：本地合成任务 + MCP stdio 模拟客户端；没有启动 WorkBuddy、没有模型/API 调用、没有提交真实评测任务。
- 临时 run ID 为每次随机生成；未作为产品运行记录保留。临时目录及产物在脚本结束后删除。

## 通过项

- 任务发布与输入文件 SHA-256 核验。
- MCP initialize、initialized 通知和 tools/list。
- 单任务领取及重复 run ID 领取拒绝。
- 预期产物路径限制、文件 SHA-256 观察和重复提交拒绝。
- `blocked` 状态交接。
- 服务端全局与 run 级 JSONL 事件、响应摘要。
- Agent 声称状态与独立任务验收状态分开，后者保持 `pending`。

## 结论边界

本结果只说明当前本地合成链路在该次模拟中完成预期协议和队列状态迁移。它不证明 WorkBuddy 能安装此 Connector、定时任务会调用它、MCP 子进程可以读写产品工作区、进程崩溃后能自动恢复，或任务产物正确。
