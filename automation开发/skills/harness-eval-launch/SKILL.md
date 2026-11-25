---
name: harness-eval-launch
description: Launch Harness evaluation runs from user choices through the project Runner and guide product-specific operator handoffs.
---

# Harness 评测启动

本 Skill 由评测侧 Agent 使用。Runner 负责准备任务、选择适配器、执行及归档；WorkBuddy Connector 负责领取和提交。不要把本 Skill 注入被测产品或把其作为 WorkBuddy 运行时 Skill。

## 启动前

1. 在包含 `automation开发/run-eval.mjs` 的交付仓库根目录工作，先读 `automation开发/README.md` 的运行准备、选择产品及对应接入说明。确认用户要求执行的 case、Harness、配置与超时；缺少必要信息时先查询本仓库，仍不能确定时询问用户。任务包只包含该 case 必需的输入。
2. 通过 `automation开发/adapters/registry.mjs` 核对可用产品：Codex、DSH、WorkBuddy、豆包工作和元宝网页均已有适配器，但支持范围不同。元宝当前仅实现单 TXT 产物；豆包工作 Connector 完成过合成文本烟测，文件任务仍须核实。不要假设登录、模型、权限或文件可用。
3. 从对话确定题目、一个或多个产品、需要的模型和运行方式。Runner 每次运行一个 case 和一个产品；可用 `node automation开发/run-eval.mjs batch run --plan <计划.json>` 串行调度显式列出的任务，并用 `batch summary --batch <批次目录>` 查看汇总。计划示例见 `automation开发/configs/batch-text-smoke.example.json`，当前批量评分仅支持文本精确验收；SpreadsheetBench 评分仍使用单次 Runner。并行调度尚未实现，人工交互、共享 profile 或队列不可假定能并行。
4. Codex 模型通过适配器配置选择，DSH 使用 profile 和 patch；检查实际配置允许的值。WorkBuddy、豆包工作和元宝的模型可控性须以当前产品证据为准，未知时如实报告。区分请求的模型、实际生效模型及其证据；不把相同模型名视为已验证一致。密钥通过既有凭据机制注入，不记录明文。
5. WorkBuddy 和豆包工作队列入口分别使用产品对应的示例或本机配置。检查 `HARNESS_EVAL_WORKBUDDY_QUEUE_ROOT` 与 `HARNESS_EVAL_WORKBUDDY_ROOT` 是有效的独立绝对路径，且与目标产品 Connector 配置一致；对端配置无法读取或确认时如实说明并取得用户核实。检查 `queue/pending/`：若有旧任务，先停止并解释会领错任务；不要自动删除、移动或重发。参考 README 的队列管理和恢复说明。禁止默认启用 `coordinated_expiry`；仅在所有消费者已确认更新并重启后，按用户选择使用该功能。

## 启动与路由

从仓库根启动 `node automation开发/run-eval.mjs run --case <case路径> --harness <产品ID> [--config <配置路径>] [--timeout <秒>]`。路径使用当前机器实际值；凭据只通过既有环境机制输入，不向用户索要明文密钥。无测试运行授权时不要启动产品或发布任务。

- Codex/DSH：持续关注进程、结束状态和 run 目录；按 README 的产品说明报告结果及尚未验证项。
- 豆包工作：选用 `automation开发/configs/doubao-work-connector.example.json`，按目标 Connector 的实际队列和发布事件交接；让用户在豆包工作客户端领取并执行匹配的真实 run ID，不将 WorkBuddy 客户端步骤套用到豆包工作。只报告已完成的阶段。
- 元宝网页：按 `automation开发/docs/元宝网页适配器操作.md` 执行；目前仅支持单个 TXT 产物。检查交互终端、独立浏览器 profile 和实际配置；需要用户确认时给出具体操作。实验性完成判断是候选信号，不能证明各任务均完成。
- WorkBuddy 队列：保持 Runner 会话运行，等待 stdout 中 JSON 事件 `event=workbuddy_queue_published`，从事件读取真实 `run_id`、`timeout_seconds`；不得猜测 run ID，也不得调用 publisher 重复发布。发布失败、没有出现事件或提前退出时报告实际错误和运行记录，不给出成功发布提示。
- 收到发布事件后立即告诉用户打开 WorkBuddy、新建对话、启用其已连接且指向相同队列的 `HarnessEval Task Queue`，并给出包含真实 run ID 的提示词：

  > 请将这项 HarnessEval 任务完整执行到提交或阻塞。只调用一次 `claim_next_task`。若返回 `empty`，报告队列为空并结束；若返回 `claimed` 且 `run_id` 匹配 `<真实run_id>`，不要只汇报领取结果或等待我再次确认，立即在同一回合按返回的任务提示和工作区合同继续处理文件。完成后调用 `submit_result`；无法安全完成时调用 `report_blocked` 并说明观察到的原因。领取后不要再次 claim，也不要重发任务。

  Runner 的 WorkBuddy 队列 prompt 已包含版本化的执行合同；它是本次 Connector 扩展条件，不表示 WorkBuddy 原生 Skill 已安装。即使产品端没有加载此项目 Skill，首次领取响应也会返回合同正文。

  告知等待时限从发布时开始。若无法直接操作 WorkBuddy，应明确由用户执行上述步骤，不声称 Agent 已触发或已创建定时任务。
4. 等待 Runner 退出或用户反馈；读取该次 `run.json`、`trace.json`、队列事件及归档产物，区分发布、领取、提交、归档和独立验收。用户称已完成不代替这些证据。评分器仅在依赖齐全且用户要求时单独调用；`submitted` 不等于任务通过。
5. 超时、blocked、异常或运行状态不明时保留原 run 和队列；检查 pending/claimed/results，再给出下一步。不要默认重新发布、复用 run ID 或删除任务。过期旧任务前必须按 README 确认所有消费者已停止，使用已记录的任务摘要；如果无法确认，停下并说明阻塞。

WorkBuddy 的 Runner 队列接入已完成人工触发的单次合成任务交接和归档；自动过期、并发和定时触发尚未验证。每次报告事实、证据位置和实际完成范围。

多项运行逐项记录 case、产品、请求/有效模型、状态、run 目录、人工操作、验收与评分；某项失败或等待人工时说明该项及其余项目状态。合成任务的 `benchmark_score: null` 不等于任务验收失败，分别读取 verification 与 score。
