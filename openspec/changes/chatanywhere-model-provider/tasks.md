# 任务

- [x] 添加独立 ChatAnywhere DPAPI 凭据 set/status/remove 与按运行加载/清理。
- [x] 增加 Codex ChatAnywhere provider mode、配置样例、preflight 和 trace 请求配置记录。
- [x] 增加 DSH ChatAnywhere 专用 patch、环境变量注入和 trace 请求配置记录。
- [x] 为两种适配器补充针对配置构造和缺失凭据阻断的自动化检查。
- [x] 更新 automation README，说明密钥设置、状态检查、模型切换命令、运行命令和证据边界。
- [x] 用轮换后的用户本机 Key 分别完成 Codex 和 DSH 最小连通 smoke；不提交或展示密钥。

## 当前验证记录

- 旧 Key 曾在 Codex smoke 收到服务端 403 风控响应；用户随后更换了 Key。旧 Key 不再复用，运行记录未包含 Key 明文。
- 新 Key 下 Codex smoke：`2026-11-26T144547-444Z-codex-command-probe-codex-70f59423`。配置请求 `deepseek-v4.1-flash-1017` / `high`，凭据来源记录为 Windows DPAPI；进程退出码 0，产物 `outputs/probe.txt` 已回收，SHA-256 与输入相同（`976a7d98…3f4ea6`）。
- 新 Key 下 DSH smoke：`2026-11-26T144748-509Z-codex-command-probe-dsh-140c86dd`。同样请求 `deepseek-v4.1-flash-1017` / `high`，凭据来源记录为 Windows DPAPI；进程退出码 0，产物哈希与输入相同。
- 两条 trace 均将产物标为 `ready`，将 benchmark 标为 `blocked`，原因是该命令探针没有集成 case oracle；不得将它们写成评测分数或正式任务通过。产品实际模型与实际推理强度仍为 unknown，trace 的 `product.model` 未提供可核实值。
- DSH 首次尝试因样例配置指向不存在的临时 profile 而在发起模型调用前失败；改用已存在的 `headless` profile 后完成以上 smoke。未将该配置错误记作产品模型调用失败。
