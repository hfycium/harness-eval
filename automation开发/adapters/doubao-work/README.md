# 豆包工作：连接器与工具证据

豆包工作使用 [`../doubao-work.mjs`](../doubao-work.mjs) 和共用的本地队列 Connector。一次合成任务和一次 E8 适配任务均已完成领取、提交和产物回收；Connector 不自动获得客户端命令调用及其返回。

## 导入操作员记录

在豆包工作原对话中展开命令工具记录，复制实际显示的命令、完整输出和退出状态，保存为 UTF-8 文本文件。仅复制明确希望归档的内容，检查其中是否包含敏感信息；不要重跑原命令。

在交付仓库根目录执行，下例的文件路径按实际情况替换，输出目录必须是 `runs/复核` 下不存在的新目录：

```powershell
node .\automation开发\adapters\doubao-work\import-evidence.mjs --run-dir 'runs/自动化/2026-11-24T141702-786Z-tracetrial-e8-cmd-doubao-work-a69ed75d' --source '<操作员保存的UTF-8文本文件>' --output-dir 'runs/复核/豆包E8工具记录-01'
```

结果包含 `operator-evidence.txt`（原始字节）和 `evidence.json`（SHA-256、run/case、导入时间及来源）。来源标为 `operator_exported`，不能视为自动采集、完整 Trace 或独立验证；导入不会修改 run，也不会自动变更题目评分。无证据时保持待复核。

本地工具使用合成数据测试通过；客户端是否提供正式可导出的机器可读工具事件仍未知。导入真实记录后需另行人工复核。
# 本机会话证据（E8）

可选配置 `configs/doubao-work-session-evidence.example.json` 会在豆包工作提交后采集本机轨迹。启动 Runner 前，在当前 PowerShell 设置：

```powershell
$env:HARNESS_EVAL_DOUBAO_SESSIONS_DIR = Join-Path $env:LOCALAPPDATA 'DoubaoWork\User Data\Default\.doubaowork\agent_mode\workspace\.sessions'
```

同时仍需配置队列和工作区环境变量，并在豆包工作内领取任务。仅支持 `tracetrial-e8-cmd`：按领取回执关联 run ID，按调用 ID 对应命令和返回；成功后保存到运行目录 `doubao-work-queue/client-tool/tool-evidence.json`。缺失、格式变化或匹配不唯一时记录 unknown。不要把整个本机会话目录提交到仓库。

现已用历史任务验证提取结果；新运行的自动采集尚待实测，现有 E8 评分器尚未读取此文件。日志属于本机观察到的产品内部格式，完整性和未来兼容性未知。
