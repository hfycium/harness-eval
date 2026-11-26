# TheAgentCompany SQL 题：四产品接入检查

检查日期：2026-11-25。对象是 `ds-sql-exercise`，本次仅审阅已有实现和历史记录，没有启动产品、获取数据库或执行评分。历史实测不等于该题已验证。

## 结论

四款产品已有 Runner 接入与其他任务的运行证据；**当前还不能直接完成 SQL 题的自动评测和评分**。主要缺口：原数据库尚未取得并冻结；原题路径和评测环境尚未适配；SQL 三文件评分尚未接入；不同产品的新题工具轨迹采集尚未验证。

| 产品 | 接入与触发 | 可用记录与 Trace | 针对 SQL 题的状态 |
|---|---|---|---|
| Codex | CLI 可由 Runner 脚本启动，已有 E8 运行记录。 | 有 run/trace、CLI stdout 事件及可选本机会话证据；完整覆盖不保证。 | 可作为接入候选；数据库交付、三产物回收和 SQL 任务实际执行未验证。 |
| DSH | CLI 可由 Runner 脚本启动，已有 E8 运行记录。 | 有 run/trace 和可用工具事件；实际配置及覆盖范围需逐次检查。 | 可作为接入候选；数据库交付、三产物回收和 SQL 任务实际执行未验证。 |
| WorkBuddy | Runner 发布队列任务；需人工启动客户端领取，已有实际任务回收记录。 | 队列事件记录 Connector 边界，可选客户端日志提取；E8 提取不能证明 SQL 的全部调用已覆盖。 | 队列接入可复用；三产物提交回收、SQL 工具证据和实际执行均未验证。 |
| 豆包工作 | Runner 发布队列任务；需人工启动客户端领取，已有合成烟测和 E8 记录。 | 有队列事件和本地会话证据；当前自动采集分支限定 E8，新题不能假定可用。 | 队列接入可复用；三产物提交回收、SQL 工具证据和实际执行均未验证。 |

四产品历史状态及证据见[评测总看板](五款产品评测总看板.md)和[统一证据事件说明](../automation开发/docs/统一证据事件使用.md)。现有 `trace.json` 为 Runner 运行记录，并不自动等于完整内部工具轨迹。

## 共同缺口与处理

1. **任务输入与环境**：先取得原题的 `database.db`，冻结版本和哈希。原题使用 Linux `/data` 和 `/workspace` 路径；当前 Runner 采用独立 Windows 工作区。需要选择原环境接入或明确记录路径改编，四款保持同一任务合同。[原题](https://github.com/TheAgentCompany/TheAgentCompany/blob/main/workspaces/tasks/ds-sql-exercise/task.md) · [Runner 输入准备](../automation开发/runner/main.mjs#L276)
2. **产物回收**：原题要求三个 TXT；Runner 合同和归档逻辑支持声明多个产物，但四产品及 Connector 对该题三文件的端到端回收未实测。[Runner 产物检查](../automation开发/runner/main.mjs#L746) · [队列发布](../automation开发/adapters/workbuddy-connector-queue.mjs#L56)
3. **独立评分**：原评分器有三个检查点及 1、2、3 分权重；当前自动入口是单文件精确文本或特定题目评分，SQL 三文件评分尚未接入。需冻结原评分器版本并处理环境依赖，或明确标为独立改编评分，检查格式误判。[原评分器](https://github.com/TheAgentCompany/TheAgentCompany/blob/main/workspaces/tasks/ds-sql-exercise/evaluator.py) · [批次评分类型](../automation开发/runner/batch.mjs#L42)
4. **证据采集**：Codex/DSH 原始输出可归档；WorkBuddy 和豆包的 Connector 事件不等于工具内部轨迹。当前统一事件转换限定 E8；豆包自动采集也限定 E8。需要为 SQL 题设计并验证采集，覆盖不足标 unknown。[统一转换限制](../automation开发/runner/normalize-evidence.mjs#L17) · [豆包采集条件](../automation开发/adapters/workbuddy-connector-queue.mjs#L117)
5. **自动化**：现有批次支持选择性串行运行和汇总；两款桌面产品仍需人工触发领取。接入 SQL 评分后才能形成对应的运行、回收、评分与汇总链路；并行和无人值守不在已验证范围。[批次实现](../automation开发/runner/batch.mjs#L114)

## 建议顺序

取得并核对原始输入与版本 → 完成 SQL 题合同和评分接入 → 用一款产品验证三文件回收与评分 → 验证其余产品及各自 Trace → 再组织四产品串行批次。正式比较前记录路径、工具、模型和提示包装差异。

## 评分和证据索引准备

已新增[独立 SQL 评分器](../automation开发/scorers/score-theagentcompany-sql.mjs)和[运行证据索引器](../automation开发/runner/index-run-evidence.mjs)。评分器读取已归档的 `task1.txt`、`task2.txt`、`task3.txt`，检查 run/trace/case 身份和产物摘要，再按原代码的 1/2/3 分规则评分。它是独立实现，官方源代码 commit 尚未冻结，也未与固定版原评分器逐项对照；结果不是官方 benchmark 分数。输入缺失或摘要不一致时为 blocked/unknown。

```powershell
node automation开发/scorers/score-theagentcompany-sql.mjs --run-dir '<运行目录>' --output-dir '<新评分目录>'
node automation开发/runner/index-run-evidence.mjs --run-dir '<运行目录>' --output-dir '<新证据目录>'
```

运行目录和输出目录须分离，输出目录必须不存在。证据索引只记录 Runner 已声明的证据路径、哈希与状态，不复制完整日志，覆盖范围仍为 unknown；它没有新增四款产品的工具事件采集，也未自动接入 Runner 批次。合成检查覆盖评分成功、部分失败及产物摘要篡改，未产生产品实测。

## 任务准备与首次启动（2026-11-25）

已取得官方 commit 的 `init.sql` 并生成本地 SQLite 输入，准备 Windows 路径改编的 [case 与来源说明](../cases/public/theagentcompany-ds-sql-exercise/来源与改编.md)。尚未对照官方镜像输入或完成官方评分器对照；本机未检测到 Docker 命令。

首次 Codex Runner 尝试 [run.json](../runs/自动化/2026-11-25T142307-040Z-theagentcompany-ds-sql-exercise-codex-198b5af3/run.json) 记录 `not_admitted`、`credential_present=false`，产品未启动。需要在持有 DeepSeek 凭据的 Windows 用户终端重新启动新 run；这不是任务失败。

用户终端随后启动的新 run [记录](../runs/自动化/2026-11-25T142449-690Z-theagentcompany-ds-sql-exercise-codex-55afbe69/run.json)完成，三个产物被归档；[独立评分](../runs/复核/theagentcompany-sql-codex-01/verification.json)为 6/6，[证据索引](../runs/复核/theagentcompany-sql-codex-evidence-01/evidence-index.json)记录原始日志摘要。该结果为本地改编题预实验，官方评分器等价及完整轨迹仍未验证；其余三款尚未运行。

DSH 首次在受限执行环境启动时因无权写入 headless profile 失败；随后用户终端的新 [run](../runs/自动化/2026-11-25T144309-714Z-theagentcompany-ds-sql-exercise-dsh-da44100f/run.json) 完成，三个产物归档，[独立评分](../runs/复核/theagentcompany-sql-dsh-01/verification.json)为 6/6；本次 `json_events=false`，未归档结构化工具事件。[证据索引](../runs/复核/theagentcompany-sql-dsh-evidence-01/evidence-index.json)。WorkBuddy、豆包工作尚未运行。

WorkBuddy 随后通过人工触发队列完成 [run](../runs/自动化/2026-11-25T144602-539Z-theagentcompany-ds-sql-exercise-workbuddy-b9bbb4d7/run.json)，三个产物归档，[独立评分](../runs/复核/theagentcompany-sql-workbuddy-01/verification.json) 6/6；队列事件和[证据索引](../runs/复核/theagentcompany-sql-workbuddy-evidence-01/evidence-index.json)已归档，客户端工具轨迹未归档。豆包工作尚未运行。
