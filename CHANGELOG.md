# ChangeLog

所有变更按时间倒序记录；每个改动单独可验证。

## 2026-11-19

- 初始化公开交付仓库 `hfycium/harness-eval`（PUBLIC，默认分支 `main`）。
- 建立目录脚手架：`docs/`、`cases/`、`runs/`、`config/`、`reports/weekly/`、`ledger/conclusions/`、`scripts/`、`public/`。

## 2026-11-21

- 新增 `reports/README.md`，规定周报与邮件稿格式，以及引用交付仓库内已提交材料的链接规则。
- 新增邮件发送格式的周报稿：`reports/邮件/2026-11-21-周报邮件稿.txt`；保留 `reports/weekly/2026-11-21.md` 作为原始周报记录。
- 周报和邮件稿中的材料引用统一改为交付仓库内的 GitHub 链接；未纳入交付仓库的研究材料不再引用其他仓库链接。
- 新增本周工作记录：`reports/weekly/2026-11-21.md`。
- 归档 SpreadsheetBench `sample_data_200` 任务 `59196` 的输入工作簿，以及 DSH、豆包工作电脑版、WorkBuddy、元宝专家模式生成的工作簿产物，按产品放入 `runs/预实验/`。
- 新增五款产品手动结果的静态验收记录：`docs/2026-11-21-五款手动结果验收.md`。记录覆盖五次尝试；四份产物仅作静态检查，Codex 本次因运行环境阻塞未生成产物，不作为正式评分或排名。
- Codex 本次尝试使用的输入工作簿一并归档；未归档产品内部 Trace，也未将静态检查表述为打开、重算或兼容性验证。

## 2026-11-23

- 将自动化开发目录统一为 `automation开发/`，补充交付仓库根 README 作为导航入口。
- 更新自动化说明中的 WorkBuddy 状态：一项合成单任务已完成实际 Connector 领取、文件写入、提交和独立哈希核验；定时触发、Runner 队列集成、Open API 与内部 Trace 仍未验证。
- 新增脱敏的 WorkBuddy Connector 单任务烟测摘要；原始事件日志和本机任务文件未纳入交付副本。
- Codex Windows 适配器显式选择 MXC；合成命令探针通过，并完成 SpreadsheetBench 59196 一次归档与官方单题比较。结果为单题 smoke，不是基准分数；实际模型/推理强度仍未确认。
- 修订过时自动化状态和失效运行记录链接，保留已有周报及邮件稿相关改动。

