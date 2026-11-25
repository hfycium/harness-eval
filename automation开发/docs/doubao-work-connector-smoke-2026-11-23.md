# 豆包工作本地 Connector 端到端烟测

日期：2026-11-23
范围：一个虚构文本任务；验证本地 STDIO Connector、任务领取、文件读写、提交、Runner 回收和评测侧精确验收。不属于公开 benchmark。

## 执行结果

- Runner 产品标识：doubao-work；入口：doubao-work-connector-queue；触发方式：用户在豆包工作对话中人工启动。
- Run ID：2026-11-23T144438-669Z-doubao-work-connector-smoke-doubao-work-6f8930dc。
- 队列任务 SHA-256：9449d400bb9c8ec65552dc578ff9d87a6cae47c9d3211713f42582a51dec6666。
- 输入 inputs/input.txt 摘要：8a28c9f2e74a62bf2d19f230acf2ce0526dbbe4a691ec9ffadce86cb4a7b06cb；连接器验证输入与发布时一致。
- Connector 日志记录匹配 run 的 claim_next_task → claimed（request_id=2）和 submit_result → submitted（request_id=3），各一次。
- Runner 记录执行完成、收到 submitted 状态并回收 outputs/probe.txt；产物 34 字节，SHA-256 1ab1a0ee01505dc39855a2fec35f5f591d70c103ec549bdc4c5e6680de258539。
- 独立文本验收按精确字节比较，archive_status=passed、task_correctness=passed、text_check.status=passed，退出码为 0。

## 评分与证据边界

该 case 是合成烟测，没有 benchmark oracle 或 benchmark 分数。score.json 因 synthetic_task_not_scored 标记为 blocked，这是预期的评分边界；精确文本验收结果单独记录在 verification.json 并已通过。

本次证明当前豆包工作客户端配置可以启动本地 STDIO Connector、领取 Runner 发布的任务、访问隔离工作区、提交产物，且 Runner 可以回收并独立验收。任务触发是人工启动，不证明定时触发。单次成功不证明跨次稳定性、产品内权限执行边界、模型身份/模式、Skill 状态或内部 Trace；这些字段继续为 unknown/unavailable。

## 证据位置

- Runner 归档：[doubao-work run](../../runs/自动化/2026-11-23T144438-669Z-doubao-work-connector-smoke-doubao-work-6f8930dc/)
- 独立验收：[verification.json](../../runs/复核/doubao-work-connector-smoke-2026-11-23-01/verification.json)
- 不计 benchmark 分数的说明：[score.json](../../runs/复核/doubao-work-connector-smoke-2026-11-23-01/score.json)
- 适配器与配置：[doubao-work.mjs](../adapters/doubao-work.mjs)、[doubao-work-connector.example.json](../configs/doubao-work-connector.example.json)
- 变更说明：[OpenSpec 变更](../../openspec/changes/doubao-work-mcp-connector-smoke/)
