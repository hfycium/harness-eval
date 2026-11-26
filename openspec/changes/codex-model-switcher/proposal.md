# Codex 模型切换命令

为日常调试提供 `codex-model show|set|reset` 命令。命令管理本机忽略的活动配置副本，基于 ChatGPT 账号配置模板生成，避免手动编辑 JSON 或覆盖模板；运行时仍使用现有 `--config` 接口。记录请求模型，实际模型保持 unknown，直到获得可核验回执。
