# 设计：Tool-Bench 双任务准入预检

## 预检路径

### 阶段 1：冻结任务

当前优先候选是 `business/hubspot/largest-open-deal`（只读查询）与 `business/hubspot/advance-globex-expansion`（更新同一 deal 的阶段和预计成交日期）。两题在官方 `tool-bench-public-dev-2` release manifest 中，manifest 标注 evaluator version 47；已固定本地源码 commit `58e695b724ce550102c048b2470ea12cca6829ac` 并检查任务合同/verifier。写入题目标状态为 deal stage `contractsent`、close date `2026-11-20`，同时保持金额不变。若任务合同、镜像或复位条件不匹配，替换候选并记录理由，不静默改题。

冻结并归档：上游 URL、commit SHA、release manifest、任务 ID 与源文件哈希、任务镜像引用/digest、工具暴露变体及实际注册工具清单、输入数据标识、契约/评分器版本、许可说明。当前审查发现默认任务配置注册 32 个 MCP endpoint；这是任务条件的一部分。必须明确选择并冻结官方暴露变体和实际注册工具清单，不得为了接入方便静默删减工具。若为便于产品接入而变更任务或暴露工具，必须标注为项目改编子集，不能称为官方 Tool-Bench 成绩。

### 阶段 2：环境与评分器先验核验

1. 只按固定版本官方文档准备依赖；不执行未审查脚本。
2. 检查每题的 task contract、expected state、请求日志/密封证据和 verifier 输入输出。
3. 使用官方参考解答与 no-op 路径校验评分器的正、负行为，并验证任务可复位、彼此隔离。
4. 缺依赖、镜像无法取得、任务无法复位或评分器不能区分无效证据时，状态为 `blocked`，停止产品预检。

2026-11-27 对当前会话与工作站分别只读探测：当前会话无 Docker CLI；工作站 Ubuntu 24.04.4 有 Docker 29.9.3 和 Compose v5.7.0，但 Docker daemon API 返回 `/var/run/docker.sock` permission denied，且非交互 SSH PATH 未找到 Cargo、Harbor、jq。工作站已有 `/etc/subuid`、`/etc/subgid` 范围和 rootless setup helper/rootlesskit，用户级 systemd 正在运行；`newuidmap`、`newgidmap`、`slirp4netns` 缺失。`sudo -n -l` 要求密码。未尝试 sudo 提权、改组权限或安装依赖。当前先标记环境阶段 `blocked`；优先由管理员安装 `uidmap`、`slirp4netns`，再以普通用户设置 rootless Docker；之后核验 daemon、Rust/Cargo、Harbor、jq 和镜像条件。

### 阶段 3：四产品接入准入

对 Codex、DSH、WorkBuddy、豆包工作逐一核实：

- 产品和适配器版本、模型/推理配置的可见性；未知项逐字段标 `unknown`。
- 是否能接入完全相同的 MCP server/tool schema、endpoint 和模拟世界；不支持则 `not_admitted`，不能静默改用本地 shell 或其他工具。
- MCP server 到隔离任务世界的寻址/认证方式、工具调用原始请求与响应能否被外部日志关联到唯一 run。
- 输入任务、提交任务和执行隔离边界；GUI 产品的人工操作及其时间/截图证据。
- 日志是否能确认每次请求经过规定 MCP endpoint，且没有其他路径改写模拟状态。

四产品若不能共享同一任务合同和工具状态，允许记录各自准入差异，但不形成四产品横向成绩。

### 阶段 4：两题链路预检

仅阶段 1–3 全部通过后，每个准入产品各跑两题各一次，且每次使用新建/复位的模拟世界。运行只验证链路和证据，不进入正式成绩。只读题检查正确事实响应及无状态改写；写入题检查所需状态变化、未授权额外变化、请求轨迹和最终响应。遇超时或状态不明不自动重试；隔离该 run 并保留原证据。

## 评分和结果状态

沿用官方 verifier 的任务契约。保存逐检查项与原始 `reward` / `outcome_code` / `assessment` 结果；不得只保存汇总 pass rate。

- `passed`：官方契约所需检查均通过，证据完整。
- `failed`：任务结果或副作用确有不符合合同的直接证据。
- `unknown`：产品或模拟服务记录不足以判断。
- `blocked`：依赖、配置、镜像或评分基础设施阻止评测。
- `not_admitted`：产品无法满足预先冻结的同等工具/环境准入条件。
- 无效契约、证据缺失、未解决答案：按官方 verifier 的无效/未评分语义单独保留，不转成 0 分。

单题官方 reward 为二元结果；两题只用于链路准入，不能凭两点做稳定性或性能结论。未来正式小规模评测需按冻结题集重复运行并报告分母、无效/跳过数及逐题分布。

## 证据归档

每个 run 关联 `run_id`、产品/适配器版本、模型及推理配置可见值、人工参与、任务/环境/评分器身份、MCP 工具清单、原始 Trace/请求日志路径与哈希、任务初末状态证据、产品产物、评分器逐项结果及复核说明。凭据不写入仓库。产品自述只能作为可见文本证据，不代替 MCP 服务日志或外部状态。

## 风险与回退

- Docker/Rust/Harbor 或镜像不可用：不跑产品，保留环境阻塞；可在工具可用的独立环境重新执行只读环境核验。
- 商业产品无法接入所需 MCP server：记录该产品 `not_admitted`，不为其单独减少工具或改任务后仍声称可比。
- 工具调用日志不能关联任务 run：外部观测不足，阻止正式评分；不得以 UI Trace 猜测请求。
- Tool-Bench 当前主分支变化：重新固定 SHA 和任务哈希；不得跨版本合并结果。
- 两道任务无区分：将该预检结论记为“题目未体现差异”，回到既有候选清单重新筛选，不凭人工难度标签宣称区分度。

## 与现有自动化的接点

首阶段只输出准入记录和任务映射，不接入正式 Runner 路由或总评分。若准入通过，再另提实现变更，明确 MCP 生命周期管理、隔离复位、证据采集、官方 verifier 包装、`unknown/blocked/not_admitted` 聚合及归档字段；不得把 Tool-Bench 评分器直接并入现有 SQL/SpreadsheetBench scorer 而不扩展评分合同。
