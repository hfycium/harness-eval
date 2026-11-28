# 提案：四款 Harness 接入 Tool-Bench HubSpot 只读诊断

## 背景

Tool-Bench 本地任务环境与官方 verifier 已通过只读题的 Oracle/no-op 校验，但 Codex、DSH、WorkBuddy、豆包工作尚未连接任务 MCP 服务。现有 Codex/DSH 适配器没有注入 Tool-Bench MCP；WorkBuddy 与豆包工作的 MCP 入口用于 Runner 队列，不等于业务工具服务。

固定 Tool-Bench 源码 commit：`58e695b724ce550102c048b2470ea12cca6829ac`。默认任务暴露 32 个 MCP endpoint。固定 commit 的 `docs/exposure-and-surface-audit.md` 将 `relevant_only` 定义为仅暴露参考计划会调用的工具，并明确它是较容易的诊断条件，不是 full catalog。

## 目标

先为四款产品建立同一条受控 MCP 接入路径，用 `business__hubspot__largest-open-deal` 只读任务验证服务发现、调用、外部请求记录和 Oracle 评分能否闭环。该轮是接入诊断，不形成正式排名。

## 范围

- 固定官方 `relevant_only` 暴露变体及该任务生成物哈希；在报告和运行配置中显式标注，不与 `full_catalog` 成绩合并。
- 通过仅绑定工作站 loopback 的服务端口和 SSH 本地转发，将 HubSpot MCP 服务安全转到评测机。
- 提供一个本机 stdio MCP 入口供四款 Harness 使用，保留 HubSpot 工具名称、参数 schema 和响应语义；记录 schema 哈希、每次请求/响应及 run 关联。
- Codex 使用本次 CLI 配置覆盖添加 MCP，DSH 使用隔离工作区的项目级 `.mcp.json`；WorkBuddy、豆包工作保留现有 Runner 队列连接器，并另行添加同一 Tool-Bench MCP 入口。人工安装步骤和版本/状态未知项明确记录。
- 为每次接入运行绑定唯一 run、隔离任务环境和独立 verifier；所有执行均需可安全停止并保留证据。

## 非目标

- 不把 `relevant_only` 结果称为 full-catalog 或官方榜单结果。
- 本轮不接入其余 31 个 endpoint，不运行状态变更题，不启动正式四产品对比。
- 不通过本机 shell、直接 HTTP API、数据库、容器网络或其他旁路修改/读取模拟世界；产品只能经指定 MCP 工具与任务交互。
- 不改变模型、Skill 或其他产品配置来追求更高任务分数；无法观测的条件继续标记 `unknown`。
- 不修改既有周报、历史运行记录、上游 Tool-Bench 源码或生成的原始任务目录。

## 成功条件

- 四款产品可见同一 HubSpot MCP 工具清单与 schema 哈希，接入条件差异被逐项记录。
- MCP 请求/响应可绑定唯一 run，模拟世界服务不可从外部旁路访问。
- 任务 Oracle/no-op 可复核；产品只读运行可由外部状态、MCP 日志和固定 verifier 判断。
- 未完成接入或证据不足时状态保持 `not_admitted`、`blocked` 或 `unknown`，不转成任务失败。
