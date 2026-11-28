# 实施任务

## A. 固定评测接入条件

- [ ] 固定 `largest-open-deal` 的官方 `relevant_only` 任务生成命令、任务/输入/Compose/工具清单哈希；标记为 easier diagnostic condition。
- [ ] 确认该变体确实只暴露 HubSpot 参考工具；保存 MCP tools/list 结果与 schema 哈希。
- [ ] 确认官方 verifier 可对该变体任务的 Oracle/no-op 独立评分；不得覆盖已归档 Oracle/no-op 结果。

## B. MCP bridge 与边界

- [x] 实现无额外依赖的本机 stdio ↔ HTTP Streamable MCP bridge；使用冻结 schema 回答 initialize/tools/list，转发 tools/call，不改工具名/schema/参数/结果。（代码已写，协议兼容性尚未 smoke 验证。）
- [x] 实现 run 绑定、单活动 run 锁、active-run 缺失时拒绝调用、事件 JSONL 与请求/响应摘要哈希。（代码已写，安全边界尚未验证。）
- [ ] 将 loopback-only Compose override 应用于已冻结任务包，仅将 HubSpot endpoint 绑定 `127.0.0.1:17123`；不得暴露 world/Admin API。（本地模板已写，尚未应用到工作站任务实例。）
- [x] 由 Runner 管理 SSH 隧道与 active-run 状态；结束时关闭入口，异常后由过期状态阻止继续调用。（实现未在工作站实测；任务环境和外部状态生命周期仍未接入。）

## C. 四个适配器

- [x] Codex：用单次 CLI 配置覆盖注册本机 bridge，不写用户全局 MCP 配置。（代码已写，尚未实际调用。）
- [x] DSH：在隔离任务工作区写入项目级 `.mcp.json`，不改用户 profile 或全局 `.mcp.json`。（代码已写，尚未实际调用。）
- [x] WorkBuddy：准备独立 Tool-Bench Connector 配置模板，保留现有队列 Connector。（UI 安装及连接确认未完成。）
- [x] 豆包工作：准备独立 Tool-Bench Connector 配置模板，保留现有队列 Connector。（UI 安装及连接确认未完成。）
- [ ] 对每款产品记录实际工具清单、schema 哈希、版本、模型/强度可见项、人工步骤和准入状态；未实测时不得标 admitted。

## D. Runner/证据

- [x] 允许没有本地 `input_source` 的服务端状态型任务；输入副本与输入哈希缺省时明确记录空数组，不生成占位 fixture。
- [ ] 增加 Tool-Bench run 生命周期入口：准备任务、检查接入、执行产品、停用 bridge/tunnel、获取外部状态、官方 verifier、归档与哈希。（当前只实现 active-run 状态绑定与 bridge 日志归档；隧道、任务环境、外部状态和 verifier 未接入。）
- [ ] 保存任务身份、exposure、prompt、adapter config、MCP events、world state/evidence、product output、verifier 输入输出及 SHA-256。（Runner 已保存 prompt/config/MCP events/tool-list admission hash；外部 world state 与 verifier 记录未接入。）
- [ ] 遇到连接/状态未知时停止，不重试、不将 unknown/blocked 转成 failed。
- [ ] 完成一个产品的非计分接入 smoke 前不得启动四产品轮次；任一产品条件不一致则不生成横向比较。
