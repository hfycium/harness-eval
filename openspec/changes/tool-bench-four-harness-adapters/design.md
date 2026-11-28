# 设计：四款 Harness 接入 Tool-Bench HubSpot 只读诊断

## 接入拓扑

```text
四款 Harness
  └─ 本机 stdio MCP bridge
       └─ HTTP Streamable MCP → 127.0.0.1:17123（Windows SSH 转发）
            └─ SSH 隧道 → 工作站 127.0.0.1:17123
                 └─ Tool-Bench tools:7123/mcp
                      └─ 内部模拟 world
```

- 工作站 Compose override 只将 HubSpot MCP 容器端口发布到 `127.0.0.1:17123`；不得发布 world/Admin API 或绑定 `0.0.0.0`。
- Windows 侧用 SSH `-L 17123:127.0.0.1:17123` 转发；本机 bridge 只连接该 loopback 地址。
- 本机 bridge 用冻结 schema 响应 `initialize/tools/list`，只转发 `tools/call`；不得新增/改名工具或改写工具参数/结果。Runner 启动前需实时查询远端 tools/list 并与冻结哈希比对。逐次记录 MCP method、工具名、参数、结果/错误和时间；运行 ID 由 Runner 的独立 active-run 状态绑定。日志脱敏规则需固定，保留原始证据哈希。
- Tool-Bench 仍由其固定任务 Compose 启动并由官方 verifier 离线验收；Oracle/no-op 校验不能替代产品运行评分。
- 任务可由外部模拟服务提供全部状态，不要求本地 fixture；Runner 因此支持 `input_source` 缺省，并在运行记录中保存空 `inputs` 数组，不伪造输入文件。

## 产品接入

| 产品 | 接入方式 | 隔离与限制 |
|---|---|---|
| Codex | Runner 通过本次 CLI 的 `-c mcp_servers.*` 参数注册本机 stdio bridge | 不改用户全局 MCP 配置；若用户配置还启用了其他 MCP，必须盘点并记录，不能据此声称工具面相同 |
| DSH | Runner 在隔离任务工作区写项目级 `.mcp.json`，再调用 DSH CLI | 不改用户级 `.mcp.json`；现有 profile 仍使用原配置，CLI 对该发现路径的实际支持须先验证 |
| WorkBuddy | 保留队列 Connector；在产品内添加 Tool-Bench stdio Connector，指向相同 bridge | Runner 队列只负责任务交接；连接器配置需人工确认，Connector 日志不等于内部 Trace |
| 豆包工作 | 保留队列 Connector；在产品内添加 Tool-Bench stdio Connector，指向相同 bridge | 连接器配置需人工确认；完整工具轨迹可能仍不可见 |

四个客户端需得到同一份冻结工具清单。若产品 UI 无法同时启用队列和 Tool-Bench connector，或实际 schema/工具集合不同，按产品标记 `not_admitted`，不做暗中替代。

## 工具暴露条件

首轮只使用固定 commit 官方 taskgen 的 `relevant_only` 变体，原因是四产品统一接入的低风险诊断。该变体只包含参考计划实际使用工具，是较容易的条件；保留其 exposure 名称、工具清单与 schema 哈希，不推断其代表 full-catalog 能力。后续若要评估 full catalog，需独立解决 32 endpoint 的发现/接入和上下文预算问题，单列条件。

## 运行及证据生命周期

1. Runner 为 run 创建独立 Tool-Bench trial、workspace、active-run 文件和只读日志目录。
2. 验证 SSH tunnel、HubSpot endpoint、MCP initialize/tools/list、schema 哈希；任一不符则不送 prompt。
3. 记录产品提交、提示词全文、工具请求/响应、产品可见输出、任务前后 world evidence、归档哈希、官方 verifier 逐项结果。
4. 任务结束后先停用 active-run、关闭 SSH/Compose 资源，再运行官方 verifier；清理状态不明时标记 `blocked` 并保留现场。

## 未知和竞争解释

- 商业产品是否允许多 MCP connector、是否稳定启动同一 stdio 进程、是否能传递所需环境变量，需实际准入确认。
- 产品内部模型、Skill、隐藏工具和完整 trace 仍可能不可见；共同 MCP 接口只控制外部工具条件，不隔离产品内部差异。
- CLI 支持 MCP 不等于产品 UI 版本也支持同样的 STDIO 方式。任何无法证据化的条件均写 `unknown`。
