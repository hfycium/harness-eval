# 实施任务

## 阶段 A：来源与任务筛选

- [x] 记录 Tool-Bench 仓库 commit、`tool-bench-public-dev-2` release manifest、evaluator version 47、许可和本地获取方式；不得以 `main` URL 代替固定 commit。已固定 commit `58e695b724ce550102c048b2470ea12cca6829ac`。
- [x] 核验候选 `business/hubspot/largest-open-deal`（只读）与 `business/hubspot/advance-globex-expansion`（状态变更）；记录 task ID、服务、所需工具、输入/数据集、初末状态和筛选理由；不匹配时再从固定版本替换。题目契约和 verifier 已检查；状态变更题将 deal stage 设为 `contractsent`、close date 设为 `2026-11-20`，金额保持不变。
- [ ] 确认两题可独立重置，优先同一服务、单服务且没有不可逆或高风险副作用。
- [ ] 明确采用的工具暴露变体；若不是官方 full catalog，标为对应官方变体或项目改编，并保存实际工具清单哈希。默认任务会暴露 32 个 MCP endpoint；需确认并冻结实际配置，不能把缩减工具集称作同条件。
- [x] 核对任务合同、上游 verifier、镜像引用/digest 及其与冻结源码版本的关系。仍需在环境成功启动后确认镜像可拉取及运行时实际工具清单。

## 阶段 B：本机环境与评分核验

- [x] 检查并记录 Docker、Rust、Harbor、jq 的版本与可用性，不执行未审查安装脚本。（2026-11-27 后续：用户安装 `uidmap`、`slirp4netns`；普通用户已配置并启动 rootless Docker 29.9.3，Compose v5.7.0；Harbor 0.23.0 安装在 `/home/cvm-204/.venvs/tool-bench`，jq 1.7 位于用户目录。未修改 rootful Docker 权限。）
- [x] 核实镜像拉取/构建条件、资源需求、网络端点、密钥要求及本地安全边界。Windows Clash 端口 7897 经 loopback SSH 隧道转发到工作站 `127.0.0.1:17897`；rootless Docker 服务只经 loopback 使用代理。官方 Artifact Registry 镜像匿名拉取受权限拒绝，因此按固定 commit 的官方 runbook 在本机构建镜像。构建使用 Docker Engine 29.9.3 内置 BuildKit；临时 Dockerfile 副本仅去掉远端 `# syntax` frontend 行，其余源内容不变，`--network=host` 只用于构建依赖下载。镜像 manifest：world `sha256:c52403610b2fec99ecfd127299f080408d5309cff7baa84bfa48655ef19ef6ff`；tools `sha256:0166f7b9baf43f3e7423766ecea06926b2d44d957a7a4b14c547b7123e11122c`。本地 Docker client 代理配置未用于 Harbor 产品/Oracle 运行。
- [x] 在无产品运行的条件下检查官方参考 Agent、no-op 结果、逐项评分和无效证据状态。仅对只读题 `business__hubspot__largest-open-deal` 运行本地镜像生成副本：Oracle `reward=1`、`outcome_code=0`、`answer_ok=1`、`state_ok=1`、`mcp_bypass=0`、2 次工具调用；官方 `nop` 对照 `reward=0`、`outcome_code=1`、0 次工具调用。状态变更题的 Oracle/no-op 和无效证据分支仍未验证。
- [ ] 验证任务实例隔离/重置、重复评分可复现和 run 身份可关联；保留评分器输入输出哈希。当前保留两个独立 run 的 result/reward/verification/world evidence 哈希，但未对同一 Agent 重复运行验证可复现性，也未核验写入题状态复位。
- [x] 若当前环境缺依赖或官方验证无法运行，记录具体阻塞并暂停，不继续产品预检。job 01–04 的环境尝试已记录在工作站 `~/tool-bench-preflight/jobs/`；这些失败未执行任务步骤，不是 Agent 失败。使用本地镜像路径后只读题环境已启动并完成 Oracle/no-op 评分校验。尚未开始四产品准入或产品运行。

## 阶段 C：四产品 MCP 接入准入

- [ ] 逐一记录 Codex、DSH、WorkBuddy、豆包工作的入口、版本、适配器、模型/强度可见信息和人工步骤。
- [ ] 验证四款产品能否连接同一个隔离 MCP 服务、相同工具 schema/数据和同等任务合同。
- [ ] 验证请求/响应可写入外部日志并绑定唯一 run；确认模拟世界不能被 MCP 以外路径修改。
- [ ] 逐产品给出 `admitted`、`not_admitted`、`blocked` 或 `unknown`，附证据路径和差异。
- [ ] 任一产品不满足共同条件时，不生成四产品比较；需改编时另立任务版本和准入合同。

## 阶段 D：两题链路预检

- [ ] 只有 A–C 阶段门槛通过后，才为每个准入产品执行两题各一次、独立世界的非正式预检。
- [ ] 对只读题核对正确响应、请求记录和状态无改写；对写入题核对预期状态变化、额外副作用和请求记录。
- [ ] 归档原始 Trace、外部请求日志、状态快照、产物、run 配置及 SHA-256。
- [ ] 调用独立 verifier，保存逐项评分、原始 outcome code、invalid/unknown/blocked 原因；不得补写历史记录。
- [ ] 不确定执行是否完成、服务可能仍在运行或状态无法确认时停止，不自动重试。

## 交付与后续决策

- [ ] 形成两题候选映射与预检报告，清楚区分来源事实、实际验证、推断和未知。当前环境与 Oracle 阻塞需解除后再继续。
- [ ] 更新 `docs/公开测试集候选.md` 的 Tool-Bench 当前状态及可执行性结论。
- [ ] 若链路通过，另起实现变更定义正式 Runner/评分接入；若未通过，列出逐产品阻塞和回退候选。
- [ ] 本 OpenSpec 完成后才决定是否进入正式评测；不得将预检写成基准分数或排名。
