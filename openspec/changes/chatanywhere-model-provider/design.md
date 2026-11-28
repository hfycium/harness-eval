# 设计

## Codex

- 使用隔离的运行级 `CODEX_HOME` 和 Codex `exec`。
- 配置 ChatAnywhere Responses API：`https://api.chatanywhere.tech/v1`，`wire_api=responses`。
- 凭据通过独立环境变量 `CHATANYWHERE_API_KEY` 注入子进程；不写入 TOML、auth 文件或 trace。
- 请求模型 `deepseek-v4.1-flash-1017`、推理强度 `high`。

## DSH

- 使用 DSH 自定义模型 API 路由 `chatanywhere`，协议为 OpenAI Chat Completions，基础地址为 `https://api.chatanywhere.tech/v1`。
- 在独立 patch 中请求 `deepseek-v4.1-flash-1017`、推理档位 `high`；V4 思考兼容格式单独声明。
- 通过 `apiKeyEnv: CHATANYWHERE_API_KEY` 读取凭据，不改写用户 profile 或 `.credentials.yaml`。

## 凭据

- 命令：`credential chatanywhere set|status|remove`。
- 存储文件：`%LOCALAPPDATA%/HarnessEval/chatanywhere-api-key.xml`，由 Windows 当前用户 DPAPI 保护。
- 与 `deepseek-api-key.xml` 完全分开。缺失时运行 preflight 应阻止产品调用。

## 证据边界

- snapshot/trace 记录请求的 provider、endpoint、协议、模型、推理档位、密钥来源和是否存在。
- 实际模型与实际推理强度先记录为 unknown。一次连通烟测只能验证请求是否被接受以及响应中的模型字段（若有），不证明供应商底层部署/推理档位的真实性。

## 主要风险

- ChatAnywhere 官方教程明确给出 Codex Responses 配置，并列出 DSH 自定义提供方和 API 地址；具体模型的协议能力及 V4 推理参数仍需通过低成本 smoke 确认。
- 转发服务可能改变模型回执、参数或路由，不能仅凭配置推断实际提供模型。
