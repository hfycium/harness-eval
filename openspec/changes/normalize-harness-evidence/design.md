# 设计：统一证据事件 v0.1

输出独立复核目录中的 `evidence-events.jsonl` 和 `manifest.json`。每条事件包含 `schema_version`、`run_id`、`product_id`、`event_type`、`tool_name`、`call_id`、`timestamp`、`data`、`source`；不存在的字段为 null，不能从模型叙述补造。`source` 包含输入文件引用、SHA-256 和行号。`data` 仅保留评分所需的命令、路径、工具返回或最终回复。

事件类型：`tool_call`、`tool_result`、`final_response`；文件访问通过工具调用名称及参数表达，不把任意 shell 命令猜测为已执行的文件访问。工具返回以原文保存，不将工具显示的非零退出码替换为独立环境预期值。

产品解析器各自维护格式识别；Codex 使用结构化 CLI 事件，DSH 使用 JSON 事件，WorkBuddy 和豆包工作使用指定的客户端会话。显式传入数据源和 run 身份；会话日志必须有能关联该 run 的领取或命令证据，歧义时停止。转换过程不得将无关对话、凭据或完整会话写入结果。

manifest 记录输入与输出哈希、格式识别结果、事件数量、匹配方法、转换器版本、`coverage: unknown` 和缺失项。记录源来自非公开客户端格式，无法保证未来版本不变。仅观察到一次调用不能在覆盖范围未知时升级为全程只调用一次。

评分器消费统一事件应作为单独步骤，先保留原评分器与既有结果；新判断必须记录原始证据和范围。缺失或异常返回 unknown，不从空列表推断未发生。
