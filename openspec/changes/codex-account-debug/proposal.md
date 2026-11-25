# Codex 调试阶段切换账号模式

默认示例配置切换为 ChatGPT 账号模式，DeepSeek 配置保留为独立示例。Windows 显式请求 MXC 和 workspace-write；账号登录状态依启动用户环境判定。账号模式支持可选的模型名，通过 CLI `--model` 传递；运行快照记录请求值，实际模型仍为未知。未指定模型时沿用 Codex 用户配置，不改变 DeepSeek 行为。
