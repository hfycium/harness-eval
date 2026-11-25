# WorkBuddy HarnessEval 队列连接器（开发候选）

这是共用于 WorkBuddy 与豆包工作的本地 stdio MCP 队列服务，提供任务领取/提交工具。两款产品均已分别完成单次合成任务的领取、产物提交和 Runner 回收；见 [WorkBuddy 记录](../../docs/workbuddy-connector-smoke-2026-11-23.md)和[豆包工作记录](../../docs/doubao-work-connector-smoke-2026-11-23.md)。产品差异由各自适配器处理。

## 当前范围

- 不依赖第三方 npm 包；MCP 消息走 stdio JSON-RPC 行协议，服务日志写入队列根目录的每-run JSONL。
- 只开放 `claim_next_task`、`submit_result`、`report_blocked` 三个工具。
- 连接器仅记录它实际收到的 MCP 工具调用和返回值。它看不到 WorkBuddy 内部推理、原生工具调用或模型路由。
- Connector 服务本身不包含或加载 Skill。Runner 的 WorkBuddy 队列模式会从 `automation开发/adapters/workbuddy/skills/workbuddy-eval-execution/SKILL.md` 注入执行合同；它是提示词扩展，不代表 WorkBuddy 原生 Skill 已安装或启用。
- 队列目录和任务工作区必须在项目仓库之外。Runner 会归档队列事件与统一 `trace.json`；这不等于客户端内部工具 Trace。豆包工作可额外[导入操作员保存的可见记录](../../adapters/doubao-work/README.md)。

## 配置准备

按 [`安装与首轮试验`](install.md) 添加本地自定义 MCP Connector。该桌面自定义入口不同于开发者市场的审核上架流程。

1. 将 `mcp.example.json` 中路径替换成当前电脑的绝对路径；不得提交含个人路径的配置。
2. `HARNESS_EVAL_WORKBUDDY_QUEUE_ROOT` 指向本机专用队列根目录；`HARNESS_EVAL_WORKBUDDY_ROOT` 指向用户明确授权的隔离工作区根目录。两个目录必须分开且都在仓库外。
3. 任务由后续 Runner 队列入口创建；产品定时任务需绑定该 Connector。每次只调用一次 `claim_next_task`；空队列正常结束；领取成功后必须继续执行返回任务，并以 `submit_result` 或 `report_blocked` 结束，不能只报告已领取。
4. 本地协议自检已通过；WorkBuddy 与豆包工作各有一次 Runner 队列端到端烟测。定时触发来源、跨次稳定性与内部 Trace 仍未完整验证。

任务发布入口：`node automation开发/connectors/workbuddy-eval/publish-task.mjs --task <task.json>`。任务文件须符合 `task.schema.json`，工作区在已授权根目录下；脚本在发布前核对输入文件摘要并拒绝 Oracle/凭据类字段。Runner 复用该发布逻辑，已完成上述两款产品的单次链路验证。

## 工具语义

- `claim_next_task`: 原子领取一个 `queued` 任务；空队列返回 `empty`；重复领取返回 `already_claimed`。
- `submit_result`: 只接受已领取 run 与合同声明的产物；服务端计算可访问文件的大小/SHA-256。Agent 提供的 summary/status 是自述，独立验收仍由评测侧进行。
- `report_blocked`: 记录权限、缺文件等阻塞，不自动重试，不自动重置队列状态。

## 未完成

- 验证定时任务触发来源、并发、重复稳定性及产品内部工具记录获取方式。
- OpenSpec 任务清单见 `openspec/changes/workbuddy-connector-queue/tasks.md`。

## 本地合成自检

运行 `node automation开发/connectors/workbuddy-eval/selfcheck.mjs` 可在系统临时目录创建虚构任务，验证 MCP/队列交互；该脚本结束时删除临时队列和产物。2026-11-22 自检通过，边界与检查项见 [`selfcheck-result-2026-11-22.md`](selfcheck-result-2026-11-22.md)。这不验证 WorkBuddy 安装、定时调度或文件权限。
