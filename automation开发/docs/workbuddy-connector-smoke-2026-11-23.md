# WorkBuddy Connector 单任务烟测记录

## 结果

**通过：**WorkBuddy 实际通过本地 MCP Connector 领取一项无评分合成任务，在指定工作区创建文本产物，并通过 Connector 提交。此记录验证一次单任务交接，不是 SpreadsheetBench 结果或五款产品排名。

## 运行摘要

- `run_id`：`wb-connector-smoke-real-20261123-01`
- 任务：仅创建 `probe.txt`，正文 `HARNESS_EVAL_CONNECTOR_SMOKE_OK`。
- 首次调用：`claim_next_task` 返回 `empty`。检查发现活动 Connector 与任务 publisher 使用了不同队列根；本次未领取任务、未改动产物。
- 修正配置后：新的单次调用返回 `claimed`，run ID 匹配；随后 `submit_result` 返回 `submitted`。
- Connector 观察到产物大小：31 bytes。
- SHA-256：`ab96439f2de90ec876080bb0a24148b9381cbd667302d03fc3e23a3007049ec5`。
- 评测侧独立读取产物，内容与大小正确，计算出的 SHA-256 与 Connector 摘要一致。原始 result JSON 中 `independent_task_verification` 保留为 `pending`，没有覆盖或改写。
- MCP 事件时间：2026-11-22 16:41:06Z 至 16:41:12Z（北京时间 2026-11-23 00:41:06 至 00:41:12）。领取和提交请求/响应均有记录。
- WorkBuddy 版本：执行报告称 `5.9.2.0`；此轮证据包未包含关于页截图或二进制版本核验，故标注为报告值。

## 结论范围

本次证明 WorkBuddy 在该配置下完成了一次 Connector 领取、工作区文件写入和提交链路。它没有验证定时任务、批量处理、Runner 队列集成、模型配置、Skill 条件、WorkBuddy 内部 Trace 或跨次稳定性。Connector JSONL 是 MCP 服务端边界证据；`submit_result` 的状态字段本身仍是 Agent 声明，正确性由独立产物检查支持。

原始 JSONL、result JSON 和产物留在本地烟测资料中；本公开记录仅保留脱敏摘要。
