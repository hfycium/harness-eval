# 自动化工具

统一入口按 `prepare`、`run` 两个阶段工作：通过注册表选择产品适配器，准备隔离任务副本和运行记录，再调用产品并收回产物。评分是单独步骤，只读取已归档运行记录和产物。

已增加选择性串行批次入口：`node automation开发/run-eval.mjs batch run --plan <计划.json>`；结果保存在 `runs/批次/`，可用 `node automation开发/run-eval.mjs batch summary --batch <批次目录>` 查看。可在计划中指定文本精确验收或 TraceTrial E8 适配题验收；结果区分运行状态与验收状态。计划、人工交互、失败策略与已验证范围见[批量运行与结果汇总](docs/批量运行与结果汇总.md)。

需要由评测侧 Agent 协助启动时，可按路径加载 [Harness 评测启动 Skill](skills/harness-eval-launch/SKILL.md)。它指导 Agent 调用统一入口并在 WorkBuddy 队列任务发布后提供具体操作和提示词；该 Skill 尚未安装到全局，也尚未通过实机端到端验证。

接入新测试集前，按[新测试集接入流程](docs/新测试集接入流程.md)准备题目、评分器和 Trace，先试跑再安排批次。

## 目录与命名

```text
automation开发/
├── run-eval.mjs                 # CLI 薄入口
├── runner/
│   ├── main.mjs                 # 单次运行编排
│   └── batch.mjs                # 批次串行调度与汇总
├── adapters/
│   ├── base.mjs                 # 适配器共同接口，支持 CLI 与会话生命周期
│   ├── registry.mjs             # 产品 ID 路由
│   ├── codex.mjs                # Codex CLI 接入逻辑
│   ├── dsh.mjs                  # DSH CLI 接入逻辑
│   ├── doubao-work.mjs          # 豆包工作本地 STDIO MCP 队列入口
│   ├── doubao-work/             # 豆包工作操作员证据导入与说明
│   ├── yuanbao-web.mjs          # 元宝网页实验性适配器
│   ├── workbuddy.mjs            # WorkBuddy 本地助理 Open API 接入
│   ├── workbuddy-connector-queue.mjs # WorkBuddy 队列入口
│   ├── workbuddy-scheduler-uia.mjs # WorkBuddy 定时任务 UIA 候选
│   └── workbuddy/               # WorkBuddy operator Skill、队列执行 Skill 与说明
├── connectors/
│   ├── workbuddy-eval/           # Runner 任务队列 stdio MCP Connector
│   └── tool-bench-mcp/           # Tool-Bench 业务工具 MCP bridge
├── configs/
│   ├── codex.example.json       # 非敏感配置模板
│   ├── dsh.example.json
│   └── workbuddy.example.json
├── contracts/
│   ├── trace-v0.2.schema.json   # 可观测运行结果契约
│   └── score-v0.2.proposed.schema.json # 待迁移的评分结果契约
├── docs/                        # 产品 API/GUI 准入记录与接入设计
└── scorers/
    ├── verify-run.py             # 归档检查与文本、表格验收入口
    ├── score-spreadsheetbench.py # 数据集单题评分器包装
    └── score-tracetrial-e8.mjs   # E8 Windows 适配题独立验收

cases/public/<dataset>-<task>/case.json
runs/自动化/<timestamp>-<case>-<product>-<id>/
```

## 组件职责与 WorkBuddy 接入关系

`adapters/` 和 `connectors/` 不是同一个执行层：

| 组件 | 谁启动/使用 | 责任 | 当前状态 |
|---|---|---|---|
| `runner/main.mjs` | 评测者 | 建立 run、隔离工作区、保存运行记录、收回产物 | DSH/Codex CLI 路径已实现；其余产品逐步接入 |
| `adapters/workbuddy.mjs` | Runner | WorkBuddy Open API 与 UIA 入口路由 | Open API 未实测；UIA selector 未验证 |
| `connectors/workbuddy-eval/server.mjs` | WorkBuddy 以 stdio MCP 子进程启动 | 提供任务领取/结果提交工具，记录 MCP 边界事件 | 已观察一次 Runner 发布→Connector 领取/提交→Runner 回收及独立验收通过；Connector 日志本身不能区分人工与定时触发，定时来源仍待产品执行历史确认 |
| `adapters/workbuddy/skills/workbuddy-connector-setup/SKILL.md` | Codex/CodeBuddy 等安装操作 Agent | 指引在 WorkBuddy UI 添加 Connector 并做空队列连接检查 | 仓库内 Skill 文件；未全局注册，需按路径加载 |
| `adapters/workbuddy/skills/workbuddy-eval-execution/SKILL.md` | Runner 与执行 Agent | 规定 WorkBuddy 队列任务只领取一次，并在同一回合执行到提交或阻塞 | Runner 注入正文到有效 prompt；一次 59196 run 完成提交与自动评分。未安装为 WorkBuddy 原生 Skill；单次成功不证明重复稳定性 |

目标数据流是：Runner 发布任务包 → WorkBuddy 领取 → MCP Connector 记录工具请求/响应 → Connector 回传产物摘要/阻塞状态 → Runner 收回归档，再由评测侧独立验收。除人工触发记录外，2026-11-23 又观察到一个合成任务发布后被 Connector 领取、提交，Runner 随后自动归档并通过文本精确验收；见[定时队列消费核验](../runs/复核/2026-11-23-workbuddy-scheduled-queue-01/定时队列消费核验.md)。调用时间符合已配置的定时周期，但 Connector JSONL 不区分触发来源，尚未归档 WorkBuddy 的调度执行历史，故定时触发归因仍待确认。首轮 SpreadsheetBench 自动评分尝试中 WorkBuddy 领取后未继续执行，Runner 超时且无产物，记录见[第一次自动评分尝试](../runs/复核/2026-11-23-workbuddy-auto-score-01/尝试记录.md)。随后在 Runner 注入执行合同、并更新评测侧启动提示的组合条件下，新 run `2026-11-23T072508-103Z-spreadsheetbench-59196-workbuddy-48610536` 完成领取、提交、自动归档和单题评分；本次仅证明组合条件下成功一次，不能拆分两项提示的影响。详情见[自动评分复测](../runs/复核/2026-11-23-workbuddy-auto-score-02/说明.md)。

### WorkBuddy 队列入口（开发中）

配置示例为 [`configs/workbuddy-queue.example.json`](configs/workbuddy-queue.example.json)。启动前在同一进程环境设置绝对路径 `HARNESS_EVAL_WORKBUDDY_QUEUE_ROOT` 和 `HARNESS_EVAL_WORKBUDDY_ROOT`；两个根应与运行中的 WorkBuddy Connector 配置一致，并位于仓库外的独立目录。适配器不能自动确认对端根目录一致。将 `<case.json>` 换为仓库内符合现有 Runner 合同的任务后，从交付仓库根目录运行：

```powershell
node automation开发/run-eval.mjs run --case <case.json> --harness workbuddy --config automation开发/configs/workbuddy-queue.example.json --timeout 900
```

Runner 发布后等待 Connector 提交，期间须由人工对话或定时任务触发领取。领取响应中的 `prompt.md` 包含队列执行合同：领取成功后需继续处理到 `submit_result` 或 `report_blocked`，不能仅汇报领取后结束。队列发布不启动 WorkBuddy；超时不自动重发。默认 `coordinated_expiry: false`，待领取文件保留供核对。新版 Connector 支持与 Runner 使用共同领取锁：确认所有消费者已更新并重启后，可在本机配置显式设置 `coordinated_expiry: true`；超时时仅将仍未领取且摘要匹配的任务转存到 `queue/expired/`。已经领取、已有结果、锁占用或状态不明时保留现场并人工核对。锁不会超时强制清除；进程异常留下的锁需要人工检查。新机制尚未做并发或产品实测，默认保持关闭。`trigger_source` 是操作者声明，Connector 事件不能独立核实触发源；结果提交不等于独立验收通过。

排查或恢复旧任务：先停止所有 WorkBuddy 队列消费者，在设置好队列根的 PowerShell 中运行：

```powershell
node automation开发/connectors/workbuddy-eval/queue-manage.mjs status --run-id <run_id>
node automation开发/connectors/workbuddy-eval/queue-manage.mjs expire --run-id <run_id> --task-sha256 <发布记录中的sha256> --consumer-stopped
```

状态检查不会修改队列。`expire` 需要操作者确认消费者已停止，并使用该 run 的发布记录摘要；只转存待领取任务，已领取、存在结果、摘要不符或锁占用时拒绝。运行记录和产物保留。命令中的 `--consumer-stopped` 是操作员声明，程序不能独立确认 WorkBuddy 是否停止。两条命令属于新实现，尚未实测。

安装用 operator Skill 只协助安装与连接检查，不是被测 WorkBuddy 的运行时 Skill。另有队列执行 Skill，Runner 在 WorkBuddy 队列模式下将其正文注入有效任务 prompt，并在 run 记录中保留摘要；此条件是 Connector + Runner-injected execution protocol，不能与 Connector-only 或原生 WorkBuddy 基线混记。MCP Connector 服务本体继续放在 `connectors/workbuddy-eval/`，不迁入 Runner adapter。

## Tool-Bench 四款产品接入（开发中）

Codex、DSH、WorkBuddy、豆包工作共用 `connectors/tool-bench-mcp/stdio-bridge.mjs`，把 Tool-Bench HubSpot Streamable HTTP MCP 转为本机 stdio；Runner 用外部控制目录中的 active-run 文件限制工具调用，并把 bridge JSONL 收入运行记录。四份配置模板分别为 `configs/codex-tool-bench.example.json`、`configs/dsh-tool-bench.example.json`、`configs/workbuddy-tool-bench.example.json`、`configs/doubao-work-tool-bench.example.json`。Codex 使用单次 CLI 配置覆盖；DSH 在隔离工作区写项目 `.mcp.json`；WorkBuddy 和豆包工作需在产品 UI 单独添加第二个 Connector，现有队列 Connector 保留。

当前完成的是代码接线与配置准备，不是产品准入或正式评测。尚未完成的项目包括 Tool-Bench 任务包与 schema 冻结、工作站 loopback 端口和 SSH 隧道生命周期、四款产品的实际 MCP 工具清单核对、协议 smoke、官方 verifier 收尾。适配器会注入 Tool-Bench MCP，但不会自动移除产品中其他可用工具；需先检查工具面并确认没有旁路调用，再决定是否准入。具体边界和状态见 [`connectors/tool-bench-mcp/README.md`](connectors/tool-bench-mcp/README.md) 与 OpenSpec `tool-bench-four-harness-adapters`。

## WorkBuddy 本机安装与验证状态

1. WorkBuddy 官方用户指南说明桌面端在「专家·技能·连接器」页右上角有「自定义连接器」入口；市场审核上架是公开发布流程，与本机添加自定义 MCP 的入口不同。[用户指南](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Connector) · [MCP 配置文档](https://open.workbuddy.cn/docs/connector)
2. 按[安装与首轮试验指南](connectors/workbuddy-eval/install.md)创建两个独立的仓库外目录，填好 [`mcp.example.json`](connectors/workbuddy-eval/mcp.example.json)，再在 WorkBuddy 自定义连接器页面添加。
3. `node automation开发/connectors/workbuddy-eval/selfcheck.mjs` 是本地合成协议自检，不启动 WorkBuddy；2026-11-22 通过，见[自检记录](connectors/workbuddy-eval/selfcheck-result-2026-11-22.md)。
4. WorkBuddy 实机在 2026-11-23 完成一次合成文本文件任务：MCP `claim_next_task` 返回预期 run，WorkBuddy 写出 `probe.txt` 并提交；独立核对内容、大小和 SHA-256 与 Connector 摘要一致。首次尝试因发布端和活动 Connector 使用不同队列根而返回 `empty`，对齐后完成。详见[实机烟测记录](docs/workbuddy-connector-smoke-2026-11-23.md)。
5. 上述单任务 smoke 当时未创建定时任务，也未接通 Runner；后续已完成 Runner 队列发布与回收，并有 SpreadsheetBench 单题自动评分记录，见上文。Open API 分支、模型配置、内部 Trace 和跨次可靠性仍未验证。版本 `5.9.2.0` 来自执行报告，版本页截图未归档。

如需让 Agent 执行安装流程，按路径加载 [`workbuddy-connector-setup Skill`](adapters/workbuddy/skills/workbuddy-connector-setup/SKILL.md)。如果它无法访问 WorkBuddy 窗口，应停止并报告，不要去改 WorkBuddy 私有配置文件或把 MCP 安装到 CodeBuddy 自己的设置里。

- 产品专属适配器由 `registry.mjs` 按 Harness ID 路由。CLI 适配器实现 `preflight`、`buildInvocation` 和观测归一化；API/GUI 会话适配器可实现 `runSession`，由 Runner 负责超时、状态记录和工作区产物归档。适配器配置只保存非敏感运行选项，个人配置用 `<product_id>.local.json`，不得放密钥。
- `run-eval.mjs` 是 CLI 薄入口；`runner/main.mjs` 负责共同生命周期、记录和归档；产品交互差异放在 `adapters/<product_id>.mjs`。新增产品需要实现适配器并注册，不能只加一份 JSON。
- WorkBuddy 适配器直接调用官方本地助理 Open API：检查本地助理在线状态、提交提示、按 message ID 轮询消息历史，并归档脱敏后的 API 证据。需要 `user.localassistant.readable` 与 `user.localassistant.invokable` scope 的 OAuth access token；适配器优先读进程环境变量 `WORKBUDDY_ACCESS_TOKEN`，否则从当前 Windows 用户的 DPAPI 凭据文件读取。token 不写入配置或运行归档。文件任务会把隔离工作区的输入/产物绝对路径写入实际提交提示词，并在工作区回收文件；这是本机路径引用，不是附件上传接口。WorkBuddy 对授权目录的读写能力仍未验证，详见 [准入记录](docs/workbuddy-api-admission.md)。
- WorkBuddy 队列 Connector 的字段、状态迁移和事件范围见 [`connectors/workbuddy-eval/README.md`](connectors/workbuddy-eval/README.md) 与[实机 smoke 记录](docs/workbuddy-connector-smoke-2026-11-23.md)。MCP JSONL 只代表 Connector 收到/返回的调用，不是 WorkBuddy 内部 Trace；任务正确性仍需评测侧独立验收。
- 产品工作区按运行 ID 隔离；默认放在系统临时目录 `HarnessEval/<run_id>`，WorkBuddy 默认使用用户 Documents 下已授权根目录的 `<run_id>` 子目录。评测侧的 case、trace、日志和运行配置留在独立归档目录。回收产物归档至每次运行的 `artifacts/` 子目录。不得关闭工作区隔离。
- 每次运行保存 `case.json`、配置快照及摘要、运行实现文件摘要、`run.json`、`trace.json`、可用的原始日志和产物。API/GUI 分支的产品级原始证据采集仍需由后续产品适配器设计；评分器另行读取运行目录，不启动产品，也不修改 trace。
- `contracts/` 中的 JSON Schema 当前作为字段契约；生成后自动校验尚未接入，首轮回归需补上 schema 校验。
- 用例目录采用 `<dataset>-<task>`，每个运行目录唯一保存输入副本、日志、结构化记录和回收产物。原始任务源文件不由运行器覆盖。
- `scripts/` 保留本机辅助工具，不属于产品评测适配器；其中 `bridge-dsh.py` 不会被统一运行器调用。

## 运行准备

通过 `--harness` 选择产品；可用 `--config` 指定本机非敏感配置。DSH 需要 profile，可用 `model_patch` 通过 `--patch` 显式请求模型条件；Codex 可选择 `chatgpt_account`、`deepseek_api` 或 `chatanywhere_api`。API Key 不写入配置模板、运行记录、日志或仓库。

调试默认模板 `configs/codex.example.json` 使用 ChatGPT 账号；DeepSeek 模板为 `configs/codex-deepseek.example.json`，现有批次如果明确引用其他配置仍按其指定模式运行。Windows 下两种模式均显式请求 MXC。

账号模式可通过配置中的 `model` 指定 CLI 模型，示例为 `configs/codex-account-model.example.json`；不设置时沿用用户 Codex 配置。示例模型来自当前本机配置，并不保证其他账号可用。运行快照记录请求模型，实际生效模型仍需证据。已在用户终端以未显式指定模型的账号配置完成一次文件探针，指定模型的运行尚待验证。

日常切换可使用统一入口维护本地活动配置：`node automation开发/run-eval.mjs codex-model set <模型名>`、`codex-model show`、`codex-model reset`。活动配置保存在被 Git 忽略的 `configs/codex-active.local.json`，不覆盖模板；运行时用 `--config automation开发/configs/codex-active.local.json`。切换仅记录请求模型，账号是否有权使用及实际生效模型仍需单次运行确认。

也可以直接在对话中提出“Codex 切到 `<模型名>`，用 `<case>` 跑一次”。启动 Skill 会先设置本地活动配置，再启动 Runner；若当前 Agent 执行环境没有你的 Codex 登录态，会一次性给出完整可复制命令，在登录终端完成切换和运行。

### DeepSeek API Key 一次配置

Windows 下可把密钥一次性保存到当前用户的 DPAPI 加密凭据文件；此文件位于 `%LOCALAPPDATA%\HarnessEval\deepseek-api-key.xml`，不能直接复制到另一台电脑或另一 Windows 用户使用。设置和状态检查：

```powershell
node .\automation开发\run-eval.mjs credential deepseek set
node .\automation开发\run-eval.mjs credential deepseek status
```

`set` 会用隐藏输入提示密钥；密钥不会出现在命令行参数或文件明文中。Runner 执行 DSH 或 Codex DeepSeek API 模式时，若当前进程已有 `DEEPSEEK_API_KEY` 则优先使用；否则从 DPAPI 存储读取，并仅注入本次 Runner/产品进程。Trace 只记凭据来源及存在性，不记密钥。删除存储：

```powershell
node .\automation开发\run-eval.mjs credential deepseek remove
```

### ChatAnywhere API Key 与模型

Codex 和 DSH 的 ChatAnywhere 凭据单独保存在 `%LOCALAPPDATA%\HarnessEval\chatanywhere-api-key.xml`，与 DeepSeek 官方 Key 分离。设置时在本机终端输入，不要把 Key 发到对话或写入配置：

```powershell
node .\automation开发\run-eval.mjs credential chatanywhere set
node .\automation开发\run-eval.mjs credential chatanywhere status
```

Codex 样例为 `configs/codex-chatanywhere.example.json`；DSH 样例为 `configs/dsh-chatanywhere.example.json`，其请求配置在 `configs/dsh.chatanywhere-high.patch.yml`。两者请求 `deepseek-v4.1-flash-1017` 和 `high` 推理档位。Codex 使用 ChatAnywhere Responses API；DSH 使用 OpenAI Chat Completions。运行时从 Windows DPAPI 解密并仅传给本次产品进程。

```powershell
node .\automation开发\run-eval.mjs run --case .\cases\smoke\codex-command-probe\case.json --harness codex --config .\automation开发\configs\codex-chatanywhere.example.json --timeout 180
node .\automation开发\run-eval.mjs run --case .\cases\smoke\codex-command-probe\case.json --harness dsh --config .\automation开发\configs\dsh-chatanywhere.example.json --timeout 180
```

移除凭据：

```powershell
node .\automation开发\run-eval.mjs credential chatanywhere remove
```

使用 ChatAnywhere 配置运行时应指定相应样例文件。trace 会记录请求 provider、模型、推理档位、协议和凭据来源；实际生效模型/推理档位仍先记为 unknown。成功返回只能证明本次 API 请求可用，不证明转发后的底层模型部署或推理档位未被服务方调整。

如果存在 `configs/dsh.local.json`，不带 `--config` 的 DSH 命令会优先使用它；该个人配置默认选择用户 DSH_HOME 下的 `headless` profile。此文件在 `.gitignore` 覆盖范围内，不包含密钥。其他电脑须分别配置本机密钥与 DSH profile。

```powershell
node automation开发/run-eval.mjs prepare --case cases/public/spreadsheetbench-59196/case.json --harness dsh
node automation开发/run-eval.mjs prepare --case cases/public/spreadsheetbench-59196/case.json --harness codex
```

`prepare` 仅建立记录与任务副本，不启动产品。配置了 `temp_workspace: true` 的适配器默认将产品工作区放在系统临时目录 `HarnessEval/<run_id>`；WorkBuddy 可通过 `workspace_root_env` 使用每台电脑单独配置的授权根目录，并在其下建立 `<run_id>` 隔离目录。输入和提示词也留一份在项目运行记录中，以便核对哈希。工作区保留供检查，不自动清理。

## 启动产品

DSH 示例：

```powershell
node automation开发/run-eval.mjs run --case cases/public/spreadsheetbench-59196/case.json --harness dsh --timeout 180
```

Codex 示例：

```powershell
node automation开发/run-eval.mjs run --case cases/public/spreadsheetbench-59196/case.json --harness codex --timeout 900
```

WorkBuddy 当前采用 MCP 队列 Connector，任务可通过人工启动 WorkBuddy 领取；定时任务是可选触发方式。Runner 到队列的合成任务发布、回收和独立验收已观察通过一次，SpreadsheetBench 单题也已完成一次自动评分。另有一次任务在约定的定时周期后被领取、提交，但尚未取得 WorkBuddy 调度执行历史，触发来源仍待确认；重复稳定性仍待验证。WorkBuddy Open API 适配器保留为独立备选，尚未真实调用。

豆包工作已新增独立的本地 STDIO Connector 队列适配器，并于 2026-11-23 完成一次 Runner 发布、客户端人工启动、Connector 领取/提交、Runner 回收和精确文本验收的合成烟测。单题文本验收通过；不产生 Benchmark 分数。定时触发、重复稳定性、产品版本、模型/模式、原生 Skill 与内部 Trace 仍未验证。配置和任务见 [doubao-work-connector.example.json](configs/doubao-work-connector.example.json)、[合成烟测 case](../cases/smoke/doubao-work-connector/)；记录见[端到端烟测](docs/doubao-work-connector-smoke-2026-11-23.md)。

豆包工作原对话里能看到的工具输出可通过[操作员证据导入工具](adapters/doubao-work/README.md)归档到独立复核目录；来源标为 `operator_exported`，不自动更改评分，也不表示 Connector 已采集内部 Trace。

WorkBuddy 可试用[本机会话证据采集器](adapters/workbuddy/会话证据采集.md)，按 run ID 查找并提取一次 Bash 命令及返回；可选 Runner 自动采集已通过一次实测。

### WorkBuddy 队列 Connector 原型

- 目录：[`connectors/workbuddy-eval/`](connectors/workbuddy-eval/)。提供任务 Schema、原子队列发布 CLI、stdio MCP 服务端、Connector metadata 与非敏感 `mcp.example.json` 模板；已在 WorkBuddy 完成合成任务调用。Runner 队列适配器完成一次合成任务的发布、回收与独立验收；定时触发归因仍待 WorkBuddy 侧执行历史确认。
- 预期队列根和工作区根需通过进程环境变量指向仓库外的专用目录。先用无敏感虚构任务核实 WorkBuddy 能否导入/启用该 Connector、定时任务是否调用工具以及 MCP 子进程/WorkBuddy Agent 能否访问隔离工作区。
- 推荐在定时任务提示中要求每轮调用一次 `claim_next_task`；空队列就结束，领取一项后按返回合同处理并调用 `submit_result` 或 `report_blocked`。claim 不自动重试，避免状态不明时重复执行。
- 连接器日志只证明服务端收到及返回了哪些 MCP 工具调用；结果文本是 Agent 自述，文件大小/摘要是连接器进程的本地观察，任务正确性仍由 Runner 独立检查。注入执行 Skill 的 run 属于 Connector + Runner-injected execution protocol 条件；与此前 Connector-only run 分开记录，不代表 WorkBuddy 原生 Skill 已安装。

UIA helper 目前支持只读控件探测，以及按唯一 AutomationId/Name 做填值、选择、读取或点击；填值优先使用 UIA ValuePattern。剪贴板粘贴默认关闭，显式开启后仅处理纯文本剪贴板并恢复原文本；未冻结 selector map 前，Runner 会在 preflight 拒绝创建/触发任务。打开 WorkBuddy 定时任务页后先执行：

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -STA -File automation开发/tools/workbuddy-scheduler-uia.ps1 -Action inspect
```

发现并复核控件后，填写 `automation开发/configs/workbuddy-scheduler.example.json` 的 selectors/workflow、状态匹配规则，并明确设置 `ui_selector_map_verified`、selector 修订号和 `status_scoped_to_run_id`；之后才可用该配置运行 Runner。该模板当前故意未准入。

```powershell
node automation开发/run-eval.mjs run --case cases/public/spreadsheetbench-59196/case.json --harness workbuddy --config automation开发/configs/workbuddy-scheduler.example.json --timeout 900
```

以下凭据步骤只适用于 WorkBuddy Open API 备选路线：

WorkBuddy API 需要已授权 OAuth 应用及有效 access token。每台电脑首次使用时，在本机安全录入 token（提示输入时不会回显）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File automation开发/tools/workbuddy-credential.ps1 -Action set
```

默认工作区根目录为当前 Windows 用户的 `Documents\HarnessEval-WorkBuddy`；在 WorkBuddy 中授权该目录。每次任务使用独立 `<run_id>` 子目录。若 Documents 被重定向或已授权目录不同，可在启动 Runner 前设置 `HARNESS_EVAL_WORKBUDDY_ROOT` 覆盖默认路径。DPAPI 凭据文件仅能由当前 Windows 用户在本机解密；迁移到另一台电脑时重新执行 `-Action set`，不要复制凭据文件。文件任务提交前会在 `workbuddy-openapi/submitted-prompt.txt` 保存实际提示词，记录输入路径与哈希、预期产物路径；收到回复后等待预期文件稳定，再交 Runner 回收。该路线尚未产品实测；未授权目录或文件往返失败时，运行结果必须保留为失败/未验证，不得记为产品准入通过。

获取 access token 需要已启用的 WorkBuddy 第三方应用和安全的服务端 token 交换；官方资料没有明确要求另租独立服务器，也未明确本地服务是否符合部署要求。个人学生的申请资格未从公开文档确认；token 有效期文档存在差异。当前 Runner 不实现 OAuth 授权、交换或刷新。完整说明见[WorkBuddy 手动准入及烟测手册](docs/workbuddy-api-admission.md#首次手动准备与运行步骤)。

Codex 使用 `codex exec --json --sandbox workspace-write`、临时会话和独立临时目录。`chatgpt_account` 模式需本机 CLI 登录；DeepSeek 与 ChatAnywhere API 模式都使用运行级 `CODEX_HOME`。DSH 使用 profile 和可选 `--patch` 条件覆盖。ChatAnywhere 配置请求同一模型名和 high 档位，但 Codex 使用 Responses、DSH 使用 Chat Completions。trace 记录请求条件而非保证服务端实际路由。产品进程退出码为 0 不自动等于任务完成；需检查运行记录、日志和产物，并另行做独立验收。

## 评分

### TraceTrial E8 Windows 适配题验收

[`scorers/score-tracetrial-e8.mjs`](scorers/score-tracetrial-e8.mjs) 读取既有运行、产物和可用日志，分别检查归档、JSON 格式、可见工具返回、已观察到的过程约束与最终回复。结果写入独立目录的 `verification.json`、`score.json`，不修改原 run；无法可靠判断的检查标记 `unknown`。

```powershell
node .\automation开发\scorers\score-tracetrial-e8.mjs --run-dir '<已有运行目录>' --output-dir '<尚不存在的复核目录>'
node .\automation开发\run-eval.mjs batch run --plan .\automation开发\configs\batch-tracetrial-e8-cmd.example.json
```

离线验收已用于 Codex、DSH 的历史运行；DSH 可通过 `configs/dsh-json-events.example.json` 启用 `--json`，真实运行已采集到工具调用、返回和最终回复。两产品批次已各自自动调用 E8 验收器一次，结果待复核；批次待复核标签的修正尚待下次运行验证。命令、结果解释与范围见 [E8 验收使用说明](docs/TraceTrial-E8验收使用.md)。这是 Windows 适配题的验收，不输出原基准官方得分。

### 独立归档验收入口（首版）

[`scorers/verify-run.py`](scorers/verify-run.py) 读取已有 `run.json`、`trace.json`、`case.json` 和归档产物，检查 run/case 标识、执行状态、产物路径及 SHA-256。每次必须指定**尚不存在**、与运行目录分开的输出目录，生成 `verification.json` 和 `score.json`；保留原运行现场及以往复核。独立入口已对一次合成任务验证正确、错误和缺失期望文件三种情况；Runner 自动调用也已完成人工触发合成任务的一次成功验证，见[验收记录](../runs/复核/2026-11-23-workbuddy-runner-auto-verification-01/verification.json)。

```powershell
node automation开发/run-eval.mjs verify --run-dir <运行目录> --output-dir <新的复核目录>
```

只检查归档时，完整性通过不意味着任务正确；`score.json` 会记录 `blocked`。合成文本任务可指定 `--artifact <题目声明的相对路径> --text-expected-file <评测侧期望文件>`，逐字节比较产物，记录双方摘要和 passed/failed；不生成 benchmark 分数。期望文件必须留在评测侧，不应放在产品工作区。

Runner 可以通过显式参数在归档后调用该文本验收首版。例如从仓库根目录启动 WorkBuddy 合成任务（每次将复核输出换成不存在的新目录，并事先配置队列环境）：

```powershell
node automation开发/run-eval.mjs run --case cases/smoke/workbuddy-queue/case.json --harness workbuddy --config automation开发/configs/workbuddy-queue.example.json --timeout 900 --verify-text-artifact outputs/probe.txt --verify-text-expected cases/smoke/workbuddy-queue/oracle/expected.txt --verification-output runs/复核/<唯一复核目录>
```

若 `python` 不在 PATH，可加 `--verify-python <python解释器路径>`；`--verify-timeout <秒>` 可设置验收进程时限，默认 120 秒。验收输出独立于 run 目录；Runner 先写原始 run/trace，再启动验收，并将调度状态写入运行目录的 `verification-dispatch.json`。原 run/trace 不回写。无需启动产品也可以对已有归档用独立命令复核。

人工触发的 WorkBuddy 合成任务已验证自动验收内容不匹配时记录 failed。隔离模拟验证了验收器无法启动和超时的状态落盘；在当次环境中进程树终止命令失败，兜底向直接子进程发送终止，子进程树状态仍为 unknown。证据和范围见[异常路径验证](../runs/复核/2026-11-23-workbuddy-auto-verification-fail-01/自动验收异常路径验证.md)。

可选 SpreadsheetBench 单题评分须显式提供 `--answer`、`--recalculated-output`、`--recalculated-from-sha256`（归档产物哈希）、`--recalculation-method`（重算软件、版本及方式）、`--evaluator` 和 `--evaluator-revision`。多个必需产物时还须传 `--artifact` 指定题目声明的相对路径。评分依赖需要在评测侧准备，不能交给产品；重算来源是操作员声明，不自动证明重算过程。比较器运行时将执行所指定的 Python 文件，须使用经过确认的固定版本官方比较器。文本验收与工作簿评分分别调用。

已有归档可通过统一入口 `node automation开发/run-eval.mjs verify ...` 执行验收和评分，不会重跑产品。若不需要独立 Excel 重算，`run` 可在产品完成并归档后直接评分产品保存的缓存值：

```powershell
node automation开发/run-eval.mjs run --case cases/public/spreadsheetbench-59196/case.json --harness <harness_id> --config <adapter.json> --timeout 900 --score-spreadsheetbench-answer <answer.xlsx> --score-spreadsheetbench-evaluator public/spreadsheetbench/evaluation/evaluation.py --score-spreadsheetbench-revision e2758ac01c6c52ef746bf0d53b2fd01dbc42dd2 --score-spreadsheetbench-output runs/复核/<唯一目录> --verify-python <python解释器路径>
```

这条自动评分会明确记录“使用产品保存的缓存值，未独立重算”，单题通过不等于基准分数。需要独立重算时，先复制归档工作簿并在 Excel 中重算保存，再对既有 run 使用 `verify`，传入重算副本、原归档 SHA-256 与操作员描述；不需要重新启动 Harness。WorkBuddy 的重算后归档复核已用 `run-eval verify` 验证通过，记录见[Runner 归档到评分记录](../runs/复核/2026-11-23-workbuddy-59196-runner-score-01/说明.md)。

调用成功时另存 `score-raw.json` 和评分器输出；比较器失败、缺少依赖或超时均保留 blocked，基准总分为 null。被测产品报告完成、归档完整和单题比较通过是不同状态。此入口仅对包含对应标准字段的自动化归档使用；此前的手动运行目录需另有合同后才能接入。

`scorers/score-spreadsheetbench.py` 是底层 v0.2 单题包装器。统一 `verify-run.py` 先检查 `run.json`、`trace.json`、`case.json` 与归档产物摘要，再调用包装器；`run-eval verify` 已在 WorkBuddy 59196 既有 run 上验证通过。`run --score-spreadsheetbench-*` 会在归档后可选触发同一验收/评分门控；新 run `2026-11-23T072508-103Z-spreadsheetbench-59196-workbuddy-48610536` 已完成一次端到端验证，归档和官方单题评分均 passed。该次评分读取产品保存的缓存值，未独立重算，`benchmark_score=null`；当前范围为 `single_test_case_smoke`。首次缺产物运行及其 blocked 记录见[第一次自动评分尝试](../runs/复核/2026-11-23-workbuddy-auto-score-01/尝试记录.md)，成功复测及 SHA/提示快照见[复测说明](../runs/复核/2026-11-23-workbuddy-auto-score-02/说明.md)。缺产物时自动评分分支尚未通过新的 Runner run 回归验证。比较器错误状态为 `blocked`，单元格不匹配为 `failed`。

```powershell
python automation开发/scorers/score-spreadsheetbench.py --case <case.json> --answer <评测侧答案文件> --recalculated-output <重算后的产物副本> --evaluator <固定版本的evaluation.py> --evaluator-revision <commit或版本> --output <score.json>
```

2026-11-23 已用公开 59196 的官方 `compare_workbooks()` 对豆包、DSH、WorkBuddy 做单题比较；三者均通过。WorkBuddy 副本经用户在 Excel 桌面端重算保存后再次通过；豆包、DSH 当前结果只对应其已保存缓存值。元宝工作簿无法被比较器解析，现记 `blocked`；Codex 没有可评分产物。结果、哈希、固定比较器和限制见[单题评分核验](../runs/复核/2026-11-23-spreadsheetbench-59196-scoring-01/评分说明.md)。该批量官方脚本的 `evaluation()` 入口在固定版本中把 `proc_path` 指向输入文件，因此本项目仅调用官方单题比较函数；详见[比较器来源与版本](../public/spreadsheetbench/README.md)。

此前 WorkBuddy 的 Runner 真实 59196 run 已通过归档检查和独立评分；后续自动评分路由也在新 run `2026-11-23T072508-103Z-spreadsheetbench-59196-workbuddy-48610536` 中对有效产物验证通过一次。该新 run 由 WorkBuddy 提交 6,651 字节工作簿，哈希 `738af730f856b2d01324e3fcd03bd5e94cdb6cf5fec2f882fb744f714e177d2f`；Runner 自动归档和官方单题评分均通过。评分读取产品缓存值，没有再次独立 Excel 重算，`benchmark_score=null`。此前只领取未执行的失败 run 及后续阻塞状态仍保留，详见[首次尝试记录](../runs/复核/2026-11-23-workbuddy-auto-score-01/尝试记录.md)。

## 当前状态（2026-11-24）

| 产品 | 已有接入与观察 | 仍需核实 |
| --- | --- | --- |
| Codex | CLI 适配器已执行 SpreadsheetBench 单题及 E8 Windows 适配题；另一次启用会话摘录的 E8 运行核对了本地用户消息全文。 | 默认临时会话条件的全文送达证据、实际模型和推理强度、跨次稳定性；早期 E8 提示词送达待核实。 |
| DSH | CLI 适配器已执行 E8 适配题并归档产物；启用 `--json` 后一次运行采集到结构化工具调用与返回。 | 提示词传递时序、有效模型和推理强度、跨次稳定性；旧文本运行的过程仍为 unknown。 |
| WorkBuddy | MCP 队列曾完成合成任务端到端验收；一次 SpreadsheetBench 单题自动评分通过。 | 需要人工启动领取或另行验证触发来源；重复稳定性、Open API 仍待核实。 |
| 豆包工作 | MCP 队列完成一次人工启动的合成文本任务及独立验收。 | 公开任务、其他文件类型及跨次稳定性。 |
| 元宝专家模式 | 实验性网页适配器已实现并进行文本任务尝试；支持人工确认和文件交互。 | 自动状态判断、产物内容验收与稳定性；不能称为完全自动接通。 |

2026-11-24 的 E8 适配题批次已串行运行 Codex 和 DSH 并自动调用验收。此前 DSH 一次运行的首轮用户消息未包含题目正文；Codex、DSH 现改用标准输入，DSH 新运行的持久会话已核对题目完整到达。Codex 的随机标记探针已通过，另一个单独启用会话摘录的 E8 运行记录到本机初始消息与题目逐字符一致；默认 ephemeral 条件和历史运行不能由此追认。详见[提示词传递与工作区核验](docs/2026-11-24-提示词传递与工作区核验.md)。产品内部轨迹并不一定可见，已归档日志、产物及来源应按各次运行核对。
