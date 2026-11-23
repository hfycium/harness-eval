# Harness 竞品评测交付仓库

本仓库保存项目交付材料、公开用例与运行产物。自动化代码的当前开发位置是 [`automation开发/`](automation开发/README.md)；产品入口通过适配器注册，统一 Runner 负责运行记录与产物归档，评分器独立执行。

## 目录

| 目录 | 内容 |
|---|---|
| [`automation开发/`](automation开发/README.md) | Runner、Harness 适配器、WorkBuddy Connector、运行/评分契约及接入记录。 |
| `cases/` | 公开任务输入和用例合同。 |
| `runs/` | 已归档的预实验与运行材料。 |
| `docs/` | 项目说明、验收记录和交付规范。 |
| `reports/` | 周报及邮件稿。 |
| `CHANGELOG.md` | 按日期记录交付仓库变化。 |

自动化状态以 `automation开发/README.md` 的当前状态为准。实验记录应区分产品实测、模拟运行和静态检查；未经独立验收的提交状态不视为任务正确。
