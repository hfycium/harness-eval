# WorkBuddy 本地自定义 MCP Connector 安装与首轮试验

本说明用于在 WorkBuddy 桌面客户端添加本机 MCP 服务。2026-11-23 已完成一次单任务合成 smoke：实际领取队列任务、创建指定文本文件并提交；这不是 benchmark 结果，不验证定时任务或 Runner 集成。新机器安装仍可按下面步骤先做空队列检查。

适配器目录下有一个配套的 operator Skill：[WorkBuddy Connector setup](../../adapters/workbuddy/skills/workbuddy-connector-setup/SKILL.md)。它用于让 Codex/其他具备桌面操作能力的 agent 按本说明执行安装；它不是安装进 WorkBuddy 的运行时 Skill，也不能自行安装自身。

## 官方支持依据

WorkBuddy 用户指南写明可从左侧「专家·技能·连接器」进入连接器管理页，并通过右上角「自定义连接器」安装自定义 MCP 服务；创建任务时可以启用已连接的 Connector。[WorkBuddy 连接器指南](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Connector)

开发者平台的「提审并发布到市场」是面向公开分发的流程。先在自己的客户端添加本地自定义 MCP，不需要先把它发布到市场。官方 MCP 配置文档说明 stdio 可用 `command`、`args`、`cwd`、`env` 配置，并可声明 Node 托管运行时。[Connector 开发文档](https://open.workbuddy.cn/docs/connector)

该次 WorkBuddy smoke 中，首轮调用曾因 Connector 和 publisher 使用不同队列根而返回 `empty`；对齐队列根/工作区根后，单任务 claim、产物生成和 submit 成功。细节见[实机烟测记录](../../docs/workbuddy-connector-smoke-2026-11-23.md)。以下步骤仍是面向新环境的通用安装流程；实际页面文案可能随版本不同。

## 1. 准备本机目录

创建两个互不包含的目录，均放在 HarnessEval 仓库之外，例如：

```text
C:\Users\<你的Windows用户名>\Documents\HarnessEval-WorkBuddy-Queue
C:\Users\<你的Windows用户名>\Documents\HarnessEval-WorkBuddy-Workspace
```

将 `<你的Windows用户名>` 替换为当前 Windows 用户目录名。工作区根目录是 WorkBuddy 任务允许读写的隔离范围；队列目录存放待领任务、状态和 MCP JSONL。不要把任务 Oracle、评分文件或密钥放进这两个目录。

确认本机 Node.js 可启动，或者使用 WorkBuddy 托管 Node 运行时（配置模板声明 `runtime.type=node`）。Connector 脚本路径是：

```text
<REPO_ROOT>\automation开发\connectors\workbuddy-eval\server.mjs
```

## 2. 在 WorkBuddy 添加自定义连接器

1. 打开 WorkBuddy 桌面端，进入「专家」→「技能」→「连接器」。
2. 点击连接器页面右上角「自定义连接器」，选择添加自定义 MCP 服务。
3. 按页面要求填写 MCP JSON 配置。可以复制本目录的 `mcp.example.json`，并把：
   - `<ABSOLUTE_PATH_TO_CONNECTOR>` 改成上面仓库中的 `workbuddy-eval` 绝对路径；
   - `<ABSOLUTE_PATH_TO_QUEUE_ROOT>` 改成第一步创建的队列目录；
   - `<ABSOLUTE_PATH_TO_AUTHORIZED_WORKSPACE_ROOT>` 改成隔离工作区根目录。
4. 保存/连接后查看页面是否显示连接成功或服务可用。若提示 `node` 找不到，可将 `command` 改成 `node.exe` 的绝对路径；运行 `Get-Command node | Select-Object -ExpandProperty Source` 可查看路径。不要改用任意安装脚本。

配置形态如下，使用实际路径替换尖括号占位符：

```json
{
  "mcpServers": {
    "harness-eval-task-queue": {
      "type": "stdio",
      "command": "node",
      "args": ["<连接器目录的绝对路径>\\server.mjs"],
      "cwd": "<连接器目录的绝对路径>",
      "runtime": { "type": "node", "version": ">=18.0.0" },
      "env": {
        "HARNESS_EVAL_WORKBUDDY_QUEUE_ROOT": "<队列目录绝对路径>",
        "HARNESS_EVAL_WORKBUDDY_ROOT": "<隔离工作区根目录绝对路径>"
      },
      "timeout": 30000
    }
  }
}
```

实际配置保存在 WorkBuddy 客户端，不要把填好个人路径的文件提交到仓库。

## 3. 只验证连接器可调用

先不要创建周期任务。新开一个普通 WorkBuddy 对话，启用 `HarnessEval Task Queue` Connector，输入：

> 请只调用一次 HarnessEval Task Queue 的 `claim_next_task`。如果返回 `empty`，直接告诉我队列为空并停止。不要创建、修改或读取其他文件，不要重复调用。

预期：MCP 工具返回结构化 `empty`。检查队列目录的 `queue/events/connector.jsonl` 是否出现这次工具请求与响应。此时应没有模型任务包、产物或 run 级记录。

如果出现工具调用错误，保留 WorkBuddy 错误提示和 MCP 服务日志，检查 JSON、Node 路径和两个目录权限。不要通过放宽工作区权限或改成任意路径工具来绕过错误。

## 4. 首轮文件往返（前置条件）

新环境只有空队列调用成功后，才做无评分虚构小文件任务：由本地发布脚本写入队列，让 WorkBuddy 领取、生成合同规定的单个产物并调用 `submit_result`。Runner 队列适配器已有首版，尚未端到端验证；独立 publisher 是此前已实测的发布入口。

暂不创建周期任务。先完成一次连接器调用和文件读写后，再配置一个本地定时 worker；把 Connector 安装、人工设置、定时触发、MCP 事件和产品运行记录分别留证。

## 结论边界

连接状态只证明 WorkBuddy 启动/连接了 MCP 服务。`connector.jsonl` 证明本地服务收到并返回了哪些 MCP 调用；它不包含 WorkBuddy 内部推理或原生工具轨迹。Agent 通过工具提交的状态是自述，产物正确性要由评测侧单独验收。启用自定义 Connector 的结果属于扩展条件，和原生 WorkBuddy 基线分开报告。
