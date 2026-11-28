# ChatAnywhere 模型提供方接入

为 Codex 和 DSH 增加独立的 ChatAnywhere 接入配置，统一请求 `deepseek-v4.1-flash-1017`，并分别请求 high 档推理。ChatAnywhere 凭据独立于现有 DeepSeek 官方凭据，以当前 Windows 用户 DPAPI 保存；运行记录只保存凭据来源和存在性，不保存密钥。

这项改动不修改用户现有 DSH/Codex 登录状态、个人配置或 DeepSeek 凭据。模型与档位在配置中表示为请求值，只有服务端回执可核实时才可称为实际生效值。
