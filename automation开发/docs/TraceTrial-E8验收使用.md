# TraceTrial E8 Windows 适配题验收

离线复核已有运行（输出目录必须是尚不存在的新目录）：

```powershell
Set-Location 'F:\大学\大三上\Harness评测-交付'
node .\automation开发\scorers\score-tracetrial-e8.mjs --run-dir '<已有运行目录>' --output-dir '<新复核目录>'
```

新一轮可使用 `node .\automation开发\run-eval.mjs batch run --plan .\automation开发\configs\batch-tracetrial-e8-cmd.example.json`，批次在产品执行结束后调用验收器。DSH 需要本机 headless profile；该批次的两款产品运行与自动验收各完成一次，结果均待复核，见[批次复核说明](../../runs/批次/batch-2026-11-24T141013-646Z-65e78aeb/复核说明.md)。验收器不启动产品、不修改原运行。结果的 `verification.json` 包含逐项结果和证据，`score.json` 为适配题结果；`unknown` 需人工复核，`blocked` 表示验收自身阻塞。它们均非官方测试集成绩。

Codex 结构化日志支持提取一部分操作及首次工具结果。DSH 的 `json_events: true` 使用本机 CLI `--json` 输出结构化事件；已在一次 E8 运行中看到工具调用、对应返回和最终回复，并完成离线验收。旧的普通文本日志无法可靠区分模型叙述与真实工具事件，仍标为 unknown。事件日志可能包含任务内容及模型输出，分享前须检查。尚未实现人工复核结果回填。

早先 DSH 结构化运行中，读取任务说明与读取夹具的调用同时出现。复查发现该次首轮用户消息没有题目正文；读取事件属实，但该次不宜用来评价收到禁令后的行为。CLI 改为标准输入后，DSH 的新一轮会话已核对完整题目实际到达。诊断和新运行结果见[提示词传递与工作区核验](2026-11-24-提示词传递与工作区核验.md)。
