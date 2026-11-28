# 提案：Tool-Bench 双任务准入预检

## 背景

现有 TheAgentCompany SQL 题四款产品均得到满分，区分度不足。TheAgentCompany Excel 格式题当前缺少原题工作簿、可用的 OwnCloud 环境和本地 scorer，暂不适合作为下一轮运行题。

项目候选清单已将 Tool-Bench 列为工具使用专项候选。其任务使用确定性模拟服务，评分检查外部服务状态和请求证据；官方规则区分任务失败、无法评分和环境错误。它适合先验证是否能用外部状态评估 Harness 工具交互，但官方全量包含 150 题、32 个 MCP endpoint、1,595 个工具，运行需 Docker、Rust 和 Harbor，不能直接视为轻量接入。

来源：
- 官方仓库与任务/评分概览：https://github.com/OpenRouterTeam/tool-bench
- 官方生产运行说明：https://github.com/OpenRouterTeam/tool-bench/blob/main/docs/production.md
- 官方本地运行手册：https://github.com/OpenRouterTeam/tool-bench/blob/main/docs/runbook.md
- 项目候选记录：`docs/公开测试集候选.md`

## 目标

在正式评测前，对 Tool-Bench 中两道候选任务开展准入预检：

1. 一道只读查询任务；
2. 一道有明确、可复位状态变化的写入任务。

检查上游版本与任务身份、环境/评分器、外部请求与状态证据，以及 Codex、DSH、WorkBuddy、豆包工作的 MCP 接入条件。预检用于决定是否进入正式小规模评测，不产生产品排名或基准成绩。

## 当前候选（尚未冻结）

从官方 release manifest `tool-bench-public-dev-2`（evaluator version 47）初筛：

- 只读：`business/hubspot/largest-open-deal`。公开任务指令要求查询仍处于 open 状态的最大 deal，并写出公司名和金额。[任务指令](https://raw.githubusercontent.com/OpenRouterTeam/tool-bench/main/tasks/business__hubspot__largest-open-deal/instruction.md)
- 状态变更：`business/hubspot/advance-globex-expansion`。公开任务指令要求更新 Globex deal 阶段和预计成交日期，同时保持金额不变。[任务指令](https://raw.githubusercontent.com/OpenRouterTeam/tool-bench/main/tasks/business__hubspot__advance-globex-expansion/instruction.md)

两题同属 HubSpot 单服务场景，便于先验证统一 MCP 接入。它们目前只是主分支与 release manifest 中的候选；在本地固定源码 commit、核验任务合同/expected checks、镜像 digest 和可复位性之前，不作为冻结用例，不启动产品运行。

## 范围

- 冻结上游 commit、任务 ID、任务与输入哈希、工具暴露配置、环境镜像标识和评分器版本。
- 先验证官方参考 Agent、空操作 Agent、任务状态复位和离线评分证据，再做产品接入预检。
- 通过预检后，最多对两题、四产品各执行一次不计入正式结果的连接/链路预检；每次使用全新且隔离的模拟世界。
- 保存产品可见 Trace、MCP 请求/响应证据、任务前后状态、答案/产物、独立评分和未知项。
- 预检期间不得把 `unknown`、环境阻塞或无法评分折算为产品失败。

## 非目标

- 不运行或复现 Tool-Bench 全部 150 道任务。
- 不声称复现其全量 1,595 工具暴露条件、官方榜单或统计结论。
- 不在本变更中开发通用 MCP 路由/评分框架，也不修改既有 Harness 适配器。
- 不把 Harness 的 MCP 接入成功等同于任务完成；不把端到端产品差异直接归因于 Harness。
- 不启动正式产品评测，直到所有准入门槛和任务合同冻结。

## 成功条件

- 两道具体任务可追溯到冻结的上游版本和任务清单。
- 独立复核确认参考解答可通过、空操作 Agent 不通过；环境错误或证据不足能保持为无效/阻塞状态。
- 每款产品的工具服务器、工具清单、提示、会话/工作区映射和人工步骤可记录；无法匹配的产品明确标记 `not_admitted`。
- 每轮结果可由外部状态和密封请求证据复核，并能关联 run、产品、配置、任务、评分器和哈希。

## 当前环境限制与进展

2026-11-27 更新：用户安装了 `uidmap`、`slirp4netns`。随后以普通用户配置 rootless Docker，验证 Docker 29.9.3、Compose v5.7.0 和 rootless security option；未修改 rootful Docker 服务或用户组。Harbor 0.23.0 位于 `/home/cvm-204/.venvs/tool-bench`，jq 1.7 位于用户目录。Tool-Bench 源码固定在 commit `58e695b724ce550102c048b2470ea12cca6829ac`。

本机 Clash Verge 的 HTTP 代理端口为 `127.0.0.1:7897`。通过仅绑定工作站 loopback 的 SSH 反向转发，工作站 `127.0.0.1:17897` 可以访问本机代理；rootless Docker daemon 通过用户级 systemd drop-in 使用该地址。Docker Hub registry/auth 可从工作站经代理访问，`debian:bookworm-slim` 拉取成功，digest 为 `sha256:e67eeead736ff7bbe258ef088bff683635c561b1fcfefad0806c1df4ab49ce0e`。临时 bridge 测试代理、测试服务和隔离 Docker 客户端配置已清理；loopback SSH 隧道和 rootless Docker 代理配置保留运行。

官方 Artifact Registry 中的 `world`/`tools` 镜像匿名下载被拒。根据固定 commit 的 `docs/runbook.md`，在 `/home/cvm-204/src/tool-bench` 按官方 Dockerfile 本地构建 `tool-bench-world:dev` 与 `tool-bench-tools:dev`，并以官方 `taskgen --world-image/--tools-image` 生成 150 个任务到独立目录 `/home/cvm-204/tool-bench-preflight/tasks-local-images`；上游 `tasks/` 未覆盖。为避免 Docker Hub frontend 获取超时，临时 Dockerfile 副本移除了首行 `# syntax=...`，其余内容不变，并用 Docker Engine 29.9.3 内置 BuildKit。`--network=host` 只用于镜像构建阶段下载锁定依赖。

只读候选生成副本的 `instruction.md`、`task.toml`、`tests/test.sh` 与固定上游源文件 SHA-256 一致；生成 task checksum 为 `a4920480171883ecd53797cff5153de277a268c8da0fca64db916250cada7c0b`。唯一区别是 Compose 镜像引用换成本地构建标签，因此结果描述为固定源代码的本地镜像预检，不声称与远端镜像字节完全相同。

该只读题在新建隔离环境中跑通 Harbor 和官方 verifier：Oracle reward=1、outcome_code=0、answer_ok=1、final_state_ok=1、mcp_bypass=0，记录 2 次 task service calls；no-op reward=0、outcome_code=1、answer_ok=0、0 次工具调用。Oracle result ID `4466c10d-e9c1-4304-aaa4-0dcf58ea248b`，no-op result ID `29dd3931-9b49-4d35-84a5-96e4b2a9a570`。原始结果、verifier 输出、world evidence 与哈希保存在工作站 `~/tool-bench-preflight/jobs/tb-preflight-largest-local-oracle-01/` 和 `tb-preflight-largest-local-nop-01/`。此前 job 01–04 的环境阻塞记录也保留在 `~/tool-bench-preflight/jobs/`，均未执行任务步骤，不能算产品失败。

这只验证了只读题的 Oracle/no-op 评分，不是产品成绩。状态变更题的参考/负对照、任务重置和可复现性尚未核验；四产品 MCP 准入也未开始。候选任务默认暴露 32 个 MCP endpoint，需冻结并记录实际工具清单，不能为单个产品静默删减后横比。
