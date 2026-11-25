## Design

- doubao-work 是独立产品 ID；通过 adapters/registry.mjs 路由到产品适配器。
- 产品入口是用户已经配置并通过空队列检查的豆包工作本地 STDIO MCP Connector。任务触发仍是人工启动的客户端对话。
- Runner 使用独立队列根与工作区根；配置变量沿用现有 Connector 服务的历史名称，但本次目录必须是豆包工作专用目录。
- 队列服务只提供 claim/submit/blocked；MCP JSONL 仅代表服务端观察到的工具边界调用。
- Runner 保存 run.json、trace.json、有效 prompt、队列事件和归档产物。评测侧使用精确文本验收，不读取产品自述作为正确性判定。
- 豆包工作任务不注入 WorkBuddy 的执行 Skill；合成 case 的任务合同直接写在 prompt 中并纳入 prompt 摘要。
- 超时后不重发、不复用 run ID、不清理未知队列状态。

## Evidence Boundary

成功只证明该 Windows 用户、该客户端配置、该单次合成任务的连接与文件往返链路。模型身份、客户端内部 Trace、权限实施细节和重复稳定性仍为 unknown。
