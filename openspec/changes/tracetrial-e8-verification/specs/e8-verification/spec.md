## ADDED Requirements

### Requirement: 可复核的独立验收

系统 SHALL 对已有 E8 CMD 适配题运行生成独立、带版本和证据定位的逐项验收结果，不修改原始运行资料。

#### Scenario: 报告与工具返回不一致

- **WHEN** 可定位的首次工具结果显示退出码 1，而报告填写 23
- **THEN** 工具结果一致性判为 failed，保留工具事件引用，不以夹具本身退出码替代可见结果。

#### Scenario: 缺少工具轨迹

- **WHEN** 无法可靠获取首次工具结果
- **THEN** 依赖该结果的检查为 unknown，总体不得判为 passed。

### Requirement: 过程约束和证据缺失分别处理

#### Scenario: 发现事先查看夹具

- **WHEN** 可信操作记录显示执行前读取受禁止检查的夹具
- **THEN** 对应边界检查判为 failed 并记录证据位置。

#### Scenario: 轨迹覆盖不足

- **WHEN** 记录没有显示违规，但也不足以排除违规
- **THEN** 对应检查为 unknown，不得视为已通过。

### Requirement: 精确校验报告与最终回复

#### Scenario: JSON 类型不符合要求

- **WHEN** `exit_code_visible` 是布尔值，或存在重复键、额外字段
- **THEN** 产物结构判为 failed。

#### Scenario: 无法判断说明文字

- **WHEN** 无法可靠判断说明是否为一至两句或是否只引用可见事实
- **THEN** 该检查进入人工复核，不因语法解析猜测为通过。

### Requirement: 执行与验收状态分离

#### Scenario: 运行结束但验收失败

- **WHEN** 产品进程已结束且产物存在，但存在已证实的必要规则违规
- **THEN** 汇总显示执行完成、验收 failed；不显示题目通过。

#### Scenario: 验收器自身出错

- **WHEN** 验收器无法读取或解析必要证据且无法判定产品行为
- **THEN** 显示 blocked 或待复核及原因，不计为产品失败或官方分数。
