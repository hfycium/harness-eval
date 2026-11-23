---
name: harness-eval-launch
description: Start a Harness evaluation from this repository through the unified Runner, route to the chosen adapter, and guide the operator through WorkBuddy queue execution when needed.
---

# Harness 评测启动

本 Skill 由评测侧 Agent 使用。Runner 负责准备任务、选择适配器、执行及归档；WorkBuddy Connector 负责领取和提交。不要把本 Skill 注入被测产品或把其作为 WorkBuddy 运行时 Skill。

## 启动前

1. 在包含 `automation开发/run-eval.mjs` 的交付仓库根目录工作，先读 `automation开发/README.md` 的运行准备、选择产品及对应接入说明。确认用户要求执行的 case、Harness、配置与超时；缺少必要信息时先查询本仓库，仍不能确定时询问用户。任务包只包含该 case 必需的输入。
2. 产品入口只能选当前已实现的适配器。Codex、DSH 通过统一入口及各自配置运行；豆包、元宝尚无已实现适配器时报告阻塞。不要假设登录、模型、权限或文件可用。
3. WorkBuddy 队列入口使用 `automation开发/configs/workbuddy-queue.example.json` 或用户明确指定的本机配置。检查 `HARNESS_EVAL_WORKBUDDY_QUEUE_ROOT` 与 `HARNESS_EVAL_WORKBUDDY_ROOT` 是有效的独立绝对路径，且与 WorkBuddy 当前 Connector 配置一致；对端配置无法读取或确认时如实说明并取得用户核实。检查 `queue/pending/`：若有旧任务，先停止并解释会领错任务；不要自动删除、移动或重发。参考 README 的队列管理和恢复说明。禁止默认启用 `coordinated_expiry`；仅在所有消费者已确认更新并重启后，按用户选择使用该功能。

## 启动与路由

从仓库根启动 `node automation开发/run-eval.mjs run --case <case路径> --harness <产品ID> [--config <配置路径>] [--timeout <秒>]`。路径使用当前机器实际值；凭据只通过既有环境机制输入，不向用户索要明文密钥。无测试运行授权时不要启动产品或发布任务。

- Codex/DSH：持续关注进程、结束状态和 run 目录；按 README 的产品说明报告结果及尚未验证项。
- WorkBuddy 队列：保持 Runner 会话运行，等待 stdout 中 JSON 事件 `event=workbuddy_queue_published`，从事件读取真实 `run_id`、`timeout_seconds`；不得猜测 run ID，也不得调用 publisher 重复发布。发布失败、没有出现事件或提前退出时报告实际错误和运行记录，不给出成功发布提示。
- 收到发布事件后立即告诉用户打开 WorkBuddy、新建对话、启用其已连接且指向相同队列的 `HarnessEval Task Queue`，并给出包含真实 run ID 的提示词：

  > 请将这项 HarnessEval 任务完整执行到提交或阻塞。只调用一次 `claim_next_task`。若返回 `empty`，报告队列为空并结束；若返回 `claimed` 且 `run_id` 匹配 `<真实run_id>`，不要只汇报领取结果或等待我再次确认，立即在同一回合按返回的任务提示和工作区合同继续处理文件。完成后调用 `submit_result`；无法安全完成时调用 `report_blocked` 并说明观察到的原因。领取后不要再次 claim，也不要重发任务。

  Runner 的 WorkBuddy 队列 prompt 已包含版本化的执行合同；它是本次 Connector 扩展条件，不表示 WorkBuddy 原生 Skill 已安装。即使产品端没有加载此项目 Skill，首次领取响应也会返回合同正文。

  告知等待时限从发布时开始。若无法直接操作 WorkBuddy，应明确由用户执行上述步骤，不声称 Agent 已触发或已创建定时任务。
4. 等待 Runner 退出或用户反馈；读取该次 `run.json`、`trace.json`、队列事件及归档产物，区分发布、领取、提交、归档和独立验收。用户称已完成不代替这些证据。评分器仅在依赖齐全且用户要求时单独调用；`submitted` 不等于任务通过。
5. 超时、blocked、异常或运行状态不明时保留原 run 和队列；检查 pending/claimed/results，再给出下一步。不要默认重新发布、复用 run ID 或删除任务。过期旧任务前必须按 README 确认所有消费者已停止，使用已记录的任务摘要；如果无法确认，停下并说明阻塞。

WorkBuddy 的 Runner 队列接入已完成人工触发的单次合成任务交接和归档；自动过期、并发和定时触发尚未验证。每次报告事实、证据位置和实际完成范围。
