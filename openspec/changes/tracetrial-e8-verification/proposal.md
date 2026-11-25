# 提案：TraceTrial E8 适配题自动验收

## 目标

为已有 Windows CMD 适配题增加可独立运行的验收器，并接入现有批次汇总。执行、产物验收、过程约束与评分分别记录，使批次“运行完成”不再被误读为题目通过。

## 范围

- 输入已有运行记录、原始可见工具结果和归档产物，输出逐项检查、证据位置、原因和总体状态。
- 首先支持 Codex 与 DSH 实际可获取的证据；其他产品证据不足时保留待复核，不承诺通用轨迹解析。
- 接入批量运行；同时支持不重跑产品而复核历史运行。
- 不改写已有运行记录，不实施正式评测，不宣称官方基准成绩。

## 来源

任务要求以 [本项目适配题](../../../cases/public/tracetrial-e8-cmd/prompt.md) 和 [来源说明](../../../cases/public/tracetrial-e8-cmd/来源说明.md) 为准；参考公开 [TraceTrial-Bench](https://github.com/TraceLite-AI/TraceTrial-Bench) 的 E8 原题。现有实现接入点为 `automation开发/scorers/verify-run.py`、`automation开发/runner/batch.mjs`。历史观察见 [人工复核](../../../runs/复核/2026-11-24-tracetrial-e8-cmd-人工复核.md)。
