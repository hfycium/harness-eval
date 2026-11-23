# Codex Windows 命令探针与 SpreadsheetBench 单题运行

日期：2026-11-23

## 结果

- 外部 PowerShell 的一次性 MXC canary 输出 `MXC_OK`，退出码为 0。
- 未显式指定 Windows 沙箱后端的首轮适配器探针中，Codex 的命令调用被拒绝，未生成产物。随后适配器在 Windows Codex DeepSeek 调用中显式指定 `windows.sandbox=mxc`，同时保留 `--sandbox workspace-write`。
- 修改后，合成文件读写探针 `2026-11-23T133136-493Z-codex-command-probe-codex-4f35ac2b` 完成；归档产物与输入的 SHA-256 相同：`976a7d98bc20cd1e91a428e853a0a64d38da06aaf7314e883c5c1391893f4ea6`。
- 随后通过同一适配器运行 SpreadsheetBench `sample_data_200` 任务 `59196`，run ID 为 `2026-11-23T135745-268Z-spreadsheetbench-59196-codex-d6d41c25`。Runner 执行完成、归档完整性检查通过，固定上游 revision `e2758ac01c6c52efc746bf0d53b2fd01dbc42dd2` 的官方单题比较通过。归档工作簿 SHA-256：`9a8caf9b9e398e3b9c6cc540722e29be7418f1429410c8d5accc887b10f4d217`。

## 结论范围

- 支持该 Windows 用户环境下，Codex 适配器在显式 MXC 后可完成一次命令读写探针和一次 SpreadsheetBench 单题任务。
- 59196 比较使用产品保存的工作簿缓存值，未做独立 Excel/LibreOffice 重算；`benchmark_score` 为 `null`。这是单题 smoke，不是基准分数或排名。
- 运行配置请求 DeepSeek `deepseek-flash` 与 reasoning effort `high`。Codex 输出了模型元数据 fallback 警告，Trace 中实际生效模型及推理强度仍是 unknown。
- 测试运行原始日志含本机路径，不随本说明发布；本说明仅记录运行 ID、摘要和哈希结果。
