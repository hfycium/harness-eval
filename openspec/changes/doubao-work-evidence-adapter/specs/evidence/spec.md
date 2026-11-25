## ADDED Requirements

### Requirement: 证据来源可追溯

#### Scenario: 导入操作员复制的工具展示

- **WHEN** 提供豆包工作有效运行和文本记录
- **THEN** 在独立目录保存原文及 SHA-256、run ID 和 `operator_exported` 来源，不修改原 run 或自动判为通过。

#### Scenario: 输入或身份不符合

- **WHEN** run 属于其他产品、证据文件缺失为空、或输出目录已存在
- **THEN** 拒绝导入，不修改既有文件。

### Requirement: 缺少原始数据不推断

#### Scenario: 产品没有可用导出记录

- **WHEN** 没有提供客户端工具展示
- **THEN** 保持该项过程证据为 unknown，不以模型生成报告充当独立 Trace。
