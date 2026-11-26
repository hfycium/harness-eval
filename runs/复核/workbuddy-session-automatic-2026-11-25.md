# WorkBuddy 自动采集实测

run `2026-11-25T065841-413Z-tracetrial-e8-workbuddy-bash-workbuddy-df1366bd`：Runner 发布后，WorkBuddy 领取并提交，Runner 自动回收 JSON 产物并从 WorkBuddy 本机会话自动提取一次 Bash 调用和返回。队列日志记录 `client_tool_evidence=captured`。

评测侧人工检查：报告命令与工具事件一致；两条状态文本、退出码 23 和失败标志与工具返回一致。产物 SHA-256 `9307288001bfb6428463eb36f4ba4283c6b9b41453465d857151702e6d5a0bcb`。

一次成功验证了自动回收和指定工具事件采集，不证明日志覆盖全部操作或题目所有约束；新 Bash 适配题尚无自动评分器。任务为人工触发，非官方基准成绩。

[运行记录](../自动化/2026-11-25T065841-413Z-tracetrial-e8-workbuddy-bash-workbuddy-df1366bd/run.json) · [工具证据](../自动化/2026-11-25T065841-413Z-tracetrial-e8-workbuddy-bash-workbuddy-df1366bd/workbuddy-queue/client-tool/tool-evidence.json)
