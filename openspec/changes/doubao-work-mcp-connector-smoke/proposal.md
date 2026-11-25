## Why

豆包工作桌面端已完成本地 STDIO Connector 的空队列调用，但尚未验证任务领取、隔离文件读写、提交、Runner 回收和独立验收。需要用一个无敏感、可精确比较的合成任务验证真实链路，再决定是否扩大接入。

## What Changes

- 为豆包工作增加独立的 doubao-work Runner 适配器和路由，复用已有本地队列/MCP 合同，不复用 WorkBuddy 产品身份或内部 Trace 假设。
- 新增只创建一个文本产物的连接器烟测用例，结果由评测侧精确文本比较器验收。
- 运行记录区分人工启动的豆包工作客户端、MCP Connector 边界事件、Runner 状态和独立验收结果。

## Non-Goals

- 不创建定时任务、不调用豆包 OpenAPI、不测试正式 Benchmark、不验证模型或内部推理轨迹。
- 不把单次合成烟测解释为跨次可靠性、产品原生基线或 Harness 排名。

## Acceptance

同一 run 中观察到 Runner 发布；豆包工作领取匹配 run；只读指定输入并写入指定产物；Connector 收到一次提交；Runner 回收产物并通过独立精确内容验收。所有阶段的 run ID、摘要与证据引用一致。若任何环节阻塞，保留运行现场并如实标记。
