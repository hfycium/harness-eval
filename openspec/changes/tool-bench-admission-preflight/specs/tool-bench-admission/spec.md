# Tool-Bench 准入预检

## ADDED Requirements

### Requirement: Freeze upstream and task identity

候选任务运行前，系统 SHALL 记录 Tool-Bench 上游 commit、release manifest、任务 ID、任务和输入哈希、镜像引用及评分器版本。不能取得或复核这些身份时，预检 MUST 保持 `blocked`，不得生成可比较的产品结果。

#### Scenario: Task source is pinned

- **当** 两道候选任务的源文件、镜像、工具暴露清单和 verifier 均与记录的固定版本一致
- **那么** 准入记录 SHALL 允许进入环境核验阶段

#### Scenario: Upstream task version is unknown

- **当** 任务来自可变分支且未记录 commit/任务哈希
- **那么** 系统 MUST 标记 `blocked`，且不得将结果标记为官方基准成绩

### Requirement: Score from external state and request evidence

评分 SHALL 基于冻结任务合同、模拟服务密封证据和外部状态；产品最终回复或其自身 Trace MUST NOT 单独作为任务完成证明。评分记录 SHALL 保留逐项检查与官方无效/未评分状态。

#### Scenario: Complete task evidence is available

- **当** 外部 verifier 可将请求日志、任务初末状态和任务合同绑定到同一 run
- **那么** 评分 SHALL 输出逐项结果和原始官方 reward/outcome code

#### Scenario: Evidence is missing or the contract is invalid

- **当** verifier 不能可靠判定或运行环境没有生成有效证据
- **那么** 结果 SHALL 标为 `unknown` 或 `blocked`/官方无效状态，且 MUST NOT 折算为任务失败分

### Requirement: Preflight products under matched conditions

四产品准入 SHALL 分别核验是否能使用相同冻结任务、MCP server、tool schema、模拟数据、状态隔离及评分契约。若为某产品改动任务或工具暴露，结果 MUST 标注为改编条件，不得与共同条件结果直接合并。

#### Scenario: A product cannot use the common MCP interface

- **当** 产品无法接入规定的 MCP server 或其请求不能被外部日志关联到 run
- **那么** 该产品 SHALL 标记 `not_admitted` 或 `blocked`，不得以本地替代调用冒充通过

### Requirement: Separate preflight from formal evaluation

两道候选任务的单次产品运行 SHALL 仅用于链路准入，不计入正式得分，不支持稳定性或总体排名结论。正式运行开始前 MUST 冻结题集、重复次数、模型/配置记录、评分规则和停止条件。

#### Scenario: Two-task integration preflight completes

- **当** 只读任务和状态变更任务各完成一次
- **那么** 报告 SHALL 仅说明接入、观测和验收链路是否可用，并明确这是两题预检
