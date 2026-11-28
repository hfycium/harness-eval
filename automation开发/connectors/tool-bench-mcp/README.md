# Tool-Bench MCP 连接器

本目录提供四款 Harness 共用的本机 stdio MCP bridge。bridge 从冻结 schema 提供 initialize/tools/list，以保证 WorkBuddy/豆包工作在 SSH 隧道尚未启动时也能启动 Connector；只有有效 run 期间才把 `tools/call` 转发至 Tool-Bench HubSpot Streamable HTTP MCP。每次请求、响应、run ID 与哈希写入项目外控制目录。

## 边界

- 只接受 `http://127.0.0.1:17123/mcp` 等 loopback HTTP endpoint；不要将 Tool-Bench 服务绑定到公网或 `0.0.0.0`。
- 只有 active-run 文件有效期间才允许 `tools/call`。没有活动 run、run 已过期或控制状态无效时，调用会被拒绝。
- bridge 的 `tools/list` 来自冻结工具 schema；Runner 启动前重新查询远端实际清单并要求 SHA-256 相符。`tools/call` 逐请求转发，不提供 shell、文件或 world/Admin API 工具。
- 本机 JSONL 记录是 MCP bridge 边界证据，不代表 Harness 的内部 Trace。
- 官方 `relevant_only` 变体是较容易的诊断条件，不等同于默认 `full_catalog`。

## 产品端配置

复制 [`mcp-connector.example.json`](mcp-connector.example.json) 中的 `harness-eval-tool-bench-hubspot` 项到 WorkBuddy 和豆包工作的自定义 MCP Connector 配置；替换 bridge 路径、工作目录和项目外控制目录。不要覆盖现有的 Runner 队列 Connector。

Codex 和 DSH 由 Runner 为单次运行注入 MCP 配置，不需要手工修改各自用户级配置。Codex 使用官方 CLI 的 `-c` 配置覆盖；DSH 的项目级 `.mcp.json` 发现方式目前按 [DSH MCP 配置参考](https://dsh-cc.github.io/reference/mcp-config.html) 实现，需在当前 DSH CLI 版本上实测后才能确认准入。

## 运行前置

1. Tool-Bench 任务环境必须单独启动，并只在工作站 loopback 发布 HubSpot MCP 端口 `17123`。
2. Windows 必须有到工作站 `127.0.0.1:17123` 的 SSH 本地转发。
3. Runner 在发送提示前创建 `active-run.json`；任务结束或中断后关闭活动状态及隧道。
4. 先核对 MCP `tools/list` 工具清单及 schema 哈希与冻结任务一致，再允许产品调用。

## Runner 配置

将 `HARNESS_EVAL_TOOL_BENCH_CONTROL_ROOT` 设为项目仓库和产品工作区之外的专用绝对目录；设置 `TOOL_BENCH_SSH_TARGET`（例如 `cvm-204@10.108.2.65`）并提供可用的 SSH 登录态；将冻结后的工具 schema SHA-256 放入 `TOOL_BENCH_EXPECTED_TOOLS_SHA256`。`TOOL_BENCH_MCP_URL` 可选，必须是 loopback 的 `http://127.0.0.1:17123/mcp`。Runner 在启动 Harness 前打开 SSH 隧道、执行 MCP initialize/tools/list 并比对冻结 hash；不匹配或连接失败时不启动产品。运行期间写入 active-run 状态，正常收尾时先关闭活动状态和隧道，再归档 `events.jsonl`。若 Runner 异常退出，状态会在期限后失效；过期状态要求人工核对，Runner 不自动覆盖。

`endpoint-inspection.mjs` 只执行 MCP 初始化和 `tools/list`，可在 tunnel 已建立时用于首次冻结工具清单。它输出完整工具 schema 和规范化 SHA-256，不调用任何业务工具。工作站 Compose 覆盖模板为 [`compose.loopback.override.example.yaml`](compose.loopback.override.example.yaml)：复制到选定任务的环境目录后使用，只将 `tools:7123` 绑定在工作站 `127.0.0.1:17123`；不改上游 Compose 文件。

逐款配置模板：

- Codex：[`configs/codex-tool-bench.example.json`](../../configs/codex-tool-bench.example.json)
- DSH：[`configs/dsh-tool-bench.example.json`](../../configs/dsh-tool-bench.example.json)
- WorkBuddy：[`configs/workbuddy-tool-bench.example.json`](../../configs/workbuddy-tool-bench.example.json)
- 豆包工作：[`configs/doubao-work-tool-bench.example.json`](../../configs/doubao-work-tool-bench.example.json)

WorkBuddy 与豆包工作仍需在各自产品 UI 中安装第二个 Tool-Bench Connector。使用本目录的 Connector 配置项并设置同一个外部控制目录；现有 Runner 队列 Connector 不要替换。当前自动化代码无法读取产品 UI 的真实 Connector 清单，也不能据模板认定已连接。

## 当前状态

- bridge、run 状态绑定及日志归档代码已写入；尚未完成 MCP 协议 smoke、真实任务连接或四款产品准入验证。
- Codex/DSH 的运行级 MCP 配置已接入适配器，但尚未在实际 CLI 版本上验证工具清单和调用。
- WorkBuddy/豆包工作仅准备了配置模板，产品 UI 安装和连接状态仍待人工确认。
- Runner 的 SSH 隧道与工具 schema 准入代码已加入，但尚未在工作站实测。Compose 覆盖文件只是模板；冻结 `relevant_only` 任务包及官方 verifier 尚未接入统一 Runner。因此现在不能启动有效 Tool-Bench 产品运行，也不能报告评分。
- 该桥日志只覆盖 bridge 收发的 MCP 边界事件，不是产品内部 Trace。
