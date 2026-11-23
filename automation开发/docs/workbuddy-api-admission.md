# WorkBuddy 接入准入记录（本地 MCP 队列主线，Open API 备选）

状态（2026-11-23）：本地 MCP Connector 已在 WorkBuddy 实际完成一次合成单任务的领取、工作区写入和提交；Runner 队列发布与回收已有首版代码，尚未端到端验证；WorkBuddy Open API 与定时任务也未验证。该 smoke 不构成公开 benchmark 结果或五产品准入结论。

**当前路线优先级（2026-11-23）**：本地 MCP Connector 已完成一次人工触发的合成单任务交接；Runner 队列接入首版待合成任务验证，再单独验证 WorkBuddy 本地定时任务触发。UI Automation 和 Open API 均为未验证候选入口，不能描述为已接通。

**UIA 实现进度（2026-11-22）**：已加入 PowerShell UIA helper，提供只读控件探测及按唯一 selector 填值、选择、读取和 Invoke；Node 适配器已接入 Runner 的 `workbuddy-local-scheduler-uia` 入口。填值需要回读匹配，任务触发前需要核对提示词、工作区和单次规则。配置模板故意保持未准入。当前执行会话只返回一个不透明顶层节点、无可见窗口和子控件，故没有执行填入、保存或“立即运行”。

## 备选直接接入方式：本地助理 Open API（未实测）

适配器通过官方 OAuth access token 直接调用 WorkBuddy PC 本地助理：先查询在线状态，再向 `/openapi/v2/localassistant/message` 发送 `msg_type=text` 消息，随后以返回的 `message_id` 查询增量消息历史。所需 scope 为 `user.localassistant.invokable` 和 `user.localassistant.readable`。token 优先从 `WORKBUDDY_ACCESS_TOKEN` 进程环境读取；若未设置，则在 Windows 上从当前用户的 DPAPI 加密凭据文件读取。配置与运行归档均不保存 token；DPAPI 文件需每台电脑分别录入。

这是“自动把任务提交到 WorkBuddy”的直接 API 路径，不需要在产品 UI 手动建任务或点“立即运行”。官方 API 请求合同仍只有文本 `content` 和 `msg_type`；消息历史中的 `attachments` 是响应字段，不能据此推断存在上传接口。因此适配器没有伪装成附件上传，而是在文本请求中注入本轮隔离工作区的输入绝对路径、输入 SHA-256、工作区和预期产物绝对路径；完成后由 Runner 在同一个隔离工作区检查并归档产物。

## 首次手动准备与运行步骤

以下是现存 Open API 候选实现的准入步骤，不是当前主线接入方式，也不代表已经完成产品实测。当前主线是先完成 MCP 队列与 Runner 的交接，再验证桌面定时触发。

### A. 先取得 Open API access token

WorkBuddy 桌面端登录态不能直接替代 Open API token。官方流程要求先在 WorkBuddy 开放平台注册并创建第三方应用，配置 OAuth 回调地址和权限范围，通过审核并启用后，再完成用户授权。[Open API 认证授权文档](https://open.workbuddy.cn/docs/openapi) · [第三方应用创建与审核说明](https://open.workbuddy.cn/docs/third-party-app)

开放平台文档的应用类型说明把“硬件接入”定位为面向硬件设备厂商与合作伙伴；本地助理 scope 列在该类可申请的权限中。Open API 授权说明也提到 Buddy 应用可配置 OAuth 回调和授权列表，但不同页面对应用类型的列举不完全一致。申请前应在实际开放平台控制台确认所选类型能否申请下列 scope。公开文档未明确个人学生是否有资格申请，也未保证申请会获批；不要把目标用户描述成已确认符合申请条件。

创建可申请本地助理权限的第三方应用，提交基本信息、用途/必要性、权限和 OAuth 回调配置并等待审核。审核通过并启用后，至少申请并启用以下 scope，用户授权时也要授予它们：

- `user.localassistant.readable`
- `user.localassistant.invokable`

授权码流程需要：

1. 在应用中登记 OAuth callback URL，并确认它与后续 token 交换时的 `redirect_uri` 完全一致。
2. 按官方 `/authorize` 流程打开授权页，使用 WorkBuddy 账号登录并同意上述 scope。授权 URL 的参数形式如下；把占位符替换为开放平台登记值，并对 `redirect_uri` 做 URL 编码：

   ```text
   https://www.workbuddy.cn/openapi/v2/authorize?response_type=code&client_id=<client_id>&redirect_uri=<encoded_redirect_uri>&scope=user.localassistant.readable%20user.localassistant.invokable&state=<random_state>
   ```

   授权回调会返回一次性 `code` 和 `state`；校验 `state`，并在 10 分钟内使用 `code`。
3. 由应用的**服务端组件**调用 `POST https://www.workbuddy.cn/openapi/v2/token`，提交 `grant_type=authorization_code`、`code`、`client_id`、`client_secret` 和原样的 `redirect_uri`，换取 access token。官方要求服务端完成交换，并禁止在客户端代码暴露 `client_secret`；文档没有要求必须另租一台长期运行的服务器，也未说明本机受保护的本地服务是否满足其部署要求。
4. 把 access token 安全交给本机操作员。不要把 `client_secret` 放进本仓库、桌面适配器代码、命令历史或日志。官方文档明确要求不得在客户端代码中暴露 `client_secret`。

应用登记、审核和 token 交换不由当前评测仓库实现。**WorkBuddy 桌面端登录态不能替代第三方应用和 OAuth 授权；没有已启用应用及安全的服务端 token 交换，就不能按当前 API 方案取得 access token。**不要把 `client_secret` 粘贴到聊天中或提交到仓库。

官方第三方应用说明的 Token 表列出 access token 24 小时、refresh token 60 天；但 Open API 响应字段示例给出 `expires_in: 3600` 秒。文档存在有效期不一致，实际应以真实授权响应的 `expires_in` 和平台确认结果为准，不应在适配器中写死 24 小时。当前评测适配器只读取 access token，**不执行 OAuth 授权、token 交换或 refresh**。refresh token 按官方说明必须安全保存在服务端，不得作为 access token 使用。

### B. 将 access token 安全保存到本机

在运行 Runner 的 Windows 用户会话中执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File automation开发/tools/workbuddy-credential.ps1 -Action set
```

在提示符中粘贴 access token。输入不回显；脚本将其写入 `%LOCALAPPDATA%\HarnessEval\workbuddy-token.xml`，由 Windows DPAPI 保护。适配器运行时读取该凭据，不把 token 写进 JSON 配置、run/trace 或普通日志。可用下面命令只检查凭据是否存在，不显示 token：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File automation开发/tools/workbuddy-credential.ps1 -Action status
```

若不想使用本机 DPAPI 文件，也可在**启动 Runner 的同一个 PowerShell 会话**中设置 `WORKBUDDY_ACCESS_TOKEN`；环境变量优先于 DPAPI 文件。不要把 token 写进共享配置或启动脚本。

### C. 准备并授权隔离工作区

默认工作区是当前 Windows 用户 Documents 下的 `HarnessEval-WorkBuddy`。先创建目录：

```powershell
$wbEvalRoot = Join-Path $env:USERPROFILE 'Documents\HarnessEval-WorkBuddy'
New-Item -ItemType Directory -Force $wbEvalRoot | Out-Null
```

在 WorkBuddy 设置中把该目录选为工作空间；官方指南说明 WorkBuddy 会在所选工作空间内读取和保存文件，并建议用文件夹选择器定位目录。[工作空间设置指南](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Task-Bar)。若 Documents 被重定向，或你要使用另一专用目录，则在启动 Runner 的同一个 PowerShell 会话中设置 `HARNESS_EVAL_WORKBUDDY_ROOT` 指向该目录，并在 WorkBuddy 中选择同一目录。每次运行会在根目录下创建独立 `<run_id>` 子目录；不要把机器绝对路径写进共享配置。

迁移到其他电脑时：在新电脑重新完成 B、C 两步并在新电脑的 WorkBuddy 授权对应目录。DPAPI 凭据文件绑定原 Windows 用户/电脑，**不要复制旧电脑的凭据文件**。

### D. 启动一轮文件烟测

确认 WorkBuddy PC 客户端已登录并运行后，在上述已配置凭据和工作区的 PowerShell 会话里启动：

```powershell
node automation开发/run-eval.mjs run --case cases/public/spreadsheetbench-59196/case.json --harness workbuddy --timeout 900
```

这会实际提交公开题目 59196，并可能消耗模型额度。适配器会自动检查 token 配置和本地助理在线状态；把隔离输入/产物绝对路径写进提交提示词；轮询回复；等预期文件在工作区连续两次检查稳定后，由 Runner 回收产物。

检查 Runner 打印的运行目录：

- `run.json` 的 `submission.status` 应为 `submitted`，产物 `collection_status` 应为 `collected` 才表示输入提交和文件回收链路观察到成功。
- `workbuddy-openapi/submitted-prompt.txt` 保存实际发给本地助理的提示词及本机路径。
- `workbuddy-openapi/messages.jsonl` 保存脱敏 API 状态和消息证据。
- `artifacts/outputs/59196_output.xlsx` 是回收副本。之后仍需用独立检查器验收内容；助手回复或文件存在都不等于题目正确。

如果 preflight 返回 `not_admitted`，先看 `run.json` 的 `missing`，常见原因是 access token 未配置/过期或配置模板不匹配。若 API 已提交但产物缺失，先确认 WorkBuddy 对授权目录的访问权限，再看 `submitted-prompt.txt` 中的路径是否与 `run.json` 输入路径一致。不要重复运行来掩盖失败；保留每次运行记录。

**依据与边界**：官方用户指南称本地任务可指定工作目录，并称 WorkBuddy 只能访问用户主动授权的文件夹；对话支持 Excel 等文件上传。[新建任务与工作空间](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Task-Bar) · [文件与目录授权说明](https://www.workbuddy.cn/docs/workbuddy/Conversation)。把这些 GUI 文件能力与本地助理文本 API 组合为“提示词传绝对路径”的桥接，是本项目的待验证实现假设，不是官方承诺的 API 文件合同。默认使用当前用户 Documents 下的 `HarnessEval-WorkBuddy`；如路径被重定向，可通过 `HARNESS_EVAL_WORKBUDDY_ROOT` 覆盖。每台电脑在 WorkBuddy 中授权其实际使用的目录；若本地助理不能按绝对路径读写，则该路径方案失败，应转向已授权工作目录的本地 GUI/UIA 适配器。

API 返回助手消息只证明 WorkBuddy 返回了可见文本，不等于任务正确，也不暴露内部工具轨迹、实际模型、Skill 或权限状态；这些字段继续记录 unknown。文件任务还要求目标产物在隔离工作区出现且连续两次轮询大小/修改时间稳定，随后由 Runner 收集并计算哈希；该条件仍不等于独立评分通过。当前 API 调用、路径权限、文件往返、超时/错误和消息轮询行为均待获授权的真实 smoke。

## 首选候选：本地定时任务 GUI 自动化

官方 WorkBuddy 用户指南说明：本地定时任务在 PC 客户端执行，可配置提示词、模型/专家/技能/连接器、工作空间、权限和单次或周期规则；支持“立即运行”，并在运行记录中查看状态、摘要、产物和完整会话。云端定时任务运行于云端沙箱，无法访问本机文件。[定时任务官方指南](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Automation-Guide)

建议单轮链路：Runner 为每次运行准备独立本地工作区和输入副本；适配器在 WorkBuddy 中创建一次性本地任务，填入任务提示、工作区及记录在案的模型/权限选项；点击“立即运行”；轮询运行记录直到完成或失败；从该本地工作区收集预期产物并由 Runner 归档。用唯一任务名绑定 run ID，避免复用任务造成上下文或产物串扰。先人工观察一次完整流程，确认页面、状态和文件路径，再判断 UIA 是否足够稳定。

已查阅的官方公开资料给出客户端操作流程，没有在 Open API 能力列表中列出定时任务创建/触发接口；不假设存在 scheduler API。首选自动化切入点是 Windows UI Automation，而不是未经证实的内部 HTTP/数据库接口。

**当前可执行性检查**：只读 UIA 探测发现 11 个 `WorkBuddy.exe` 进程，但当前运行会话可见的顶层窗口数为 0，候选控件数为 0；进程 `MainWindowHandle` 均为 0。这只说明本次自动化会话没有取得可访问桌面窗口，不能判断 WorkBuddy 界面不支持 UIA。下一步需要在可访问用户交互桌面的会话中打开定时任务页面，再探测一次控件树。

执行条件要单独记录：定时任务允许选择模型、专家、技能和连接器；选择的模型下线时文档称会自动切换。默认权限可能在敏感操作时等待人工确认；完全访问权限支持无人值守，但会改变运行条件。云端任务不能用于本地 xlsx 文件题。[定时任务运行与权限说明](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Automation-Guide)

## 已由官方文档说明

- 本地助理 API 可查询 PC 助理在线状态、发送消息并查询消息历史。发送消息示例包含 `content` 与 `msg_type`，接口要求用户授权。
- 云任务 API 可创建、查询任务并取得 ACP 连接信息。ACP 支持 SSE 推送、JSON-RPC 会话交互和权限请求；会话产物 REST 接口可查询 plan、tasks、media、overview。
- 云任务产物的媒体下载说明包含 URL 与 `agent:///` URI 映射方式。
- 上述接口请求示例没有 model、mode 字段。此处只表示文档未提供这些参数。

官方依据：

- [WorkBuddy Open API：本地助理、认证与消息接口](https://open.workbuddy.cn/docs/openapi)
- [WorkBuddy Open API：Cloud Task、ACP 与 Session Artifacts](https://open.workbuddy.cn/en/docs/openapi)

## 尚未确认

- 本地助理 API 是否能访问由用户授权的隔离目录，以及能否按提示中的绝对路径读取 xlsx、写回产物。
- 云任务能否读取本次运行的输入文件、写入隔离工作区，并以 xlsx 格式回收产物。
- 产物接口是否保证返回完整的工作簿二进制文件，而不只是媒体元数据或其他会话材料。
- 本地助理 API 或云任务 API 是否对应本项目要测的 WorkBuddy 产品入口和版本。
- 通过 API 能否固定或可靠记录模型、工作模式及内置 Skill 状态。

“文档未说明”不等同于“产品不支持”。目前实现已从硬阻断改为文件路径交接尝试，但没有真实文件往返证据，因此尚不足以将 SpreadsheetBench 文件任务标为产品准入通过。

## Open API 与 GUI 的准入边界

官方 Open API 的本地助理消息接口可直接提交文本并通过 message history 增量查询回复；消息历史响应包含 `attachments` 字段，但已查阅的请求合同没有文件上传字段或附件创建端点。适配器目前通过本机绝对路径引用，让本地助理尝试从已授权隔离目录读取/写入文件，不能称为官方文件上传能力。云端任务接口运行于云端沙箱，不适用于依赖本机工作簿的任务。

历史接入判断（2026-11-22）：当时优先验证客户端本地一次性定时任务/UIA 路线。2026-11-23 已另行完成人工触发的 MCP Connector 单任务 smoke；定时调度仍未验证。现有本地助理 Open API 直连实现仍是备选，需第三方应用申请、审核与用户 OAuth 授权，且文件路径交接未实测。公开 API 文档未列出定时任务创建/触发接口，不能伪造 HTTP 调度接口。

## 当前 Runner 限制

Runner 的 `runSession()` 支持直接 API 生命周期、超时取消和归档证据引用。当前适配器不实现 OAuth 交互/refresh token、SSE 或云任务 ACP；它使用消息历史轮询官方本地助理接口。

## 准入清单

完成以下验证后再将状态改为 `admitted`：

1. 明确目标是 PC 本地助理还是云端任务，并记录产品入口、版本和账号授权范围。
2. 用无敏感虚构文件验证输入注入方式；保存实际请求/界面证据和输入哈希。
3. 验证返回的工作簿可下载、SHA-256 可计算，并能由评测侧独立检查。
4. 记录状态完成证据、权限请求与响应、超时/失败语义。
5. 记录模型、模式字段是否可设置或可见；不可见时写 `unknown`。
6. **首选**：在交互桌面中用专用虚构工作簿副本创建本地一次性定时任务并执行“立即运行”，记录任务配置、工作区、运行记录、可见会话及输入/输出 SHA-256；确认后再实现 UIA 驱动。
7. **备选**：仅在获得已启用的第三方应用和授权 token 后验证本地助理 API；未取得 token 不等于产品不支持。

## 本地一次性任务的候选触发步骤（文档依据，尚未实机执行）

官方指南给出的可操作路径如下，可用于下一轮无敏感文件预检：

1. 打开 WorkBuddy 左侧导航的「定时任务」，进入「定时任务」页签；通过右上角「新建」选择手动新建。
2. 设置唯一任务名和固定提示词；将工作空间指定为本轮专用目录，并先把虚构测试文件的副本放入该目录。
3. 在提示词底部显式记录/选择模型、专家、技能和连接器；设置权限。需要无人值守才考虑「完全访问」，否则默认权限可能停在待确认状态。模型下线时存在自动切换可能，故运行时配置要留证。
4. 将重复规则设为「单次」并保存。随后在任务卡片上点「立即运行」来触发单次运行；指南称该操作立即执行一次且不改变原计划。这样不必等到定时点。
5. 在「运行记录」确认本次条目进入运行中、成功或失败状态，并记录开始时间、耗时和失败原因；打开任务运行页检查该次会话、摘要与产物。
6. 从运行产物/指定工作空间回收文件副本，记录路径、大小和 SHA-256；由独立检查器验证工作簿内容。不要只凭对话声称完成。

依据：[官方定时任务指南](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Automation-Guide)，其中“创建定时任务”列出配置项（约 237–249 行），“常用操作”说明立即运行与查看运行记录（约 286–295 行），“运行结果”说明状态、摘要、产物和会话（约 310–327 行）。本次核对的 Open API 文档能力目录包括本地助理、云端任务、ACP 和会话产物，没有列出定时任务创建/触发 API；因此现有证据支持先走客户端 UI 候选流程，不代表已排除未公开接口。

## 本机检查与验证边界（2026-11-22）

- **本机观察**：此前核验的客户端文件版本为 `5.9.2`，进程列表中存在多个 `WorkBuddy.exe` 进程。本轮 UI Automation 根窗口枚举仍发现多个产品进程，但没有发现进程关联的可访问顶层窗口；这只描述当前执行会话，不能证明用户桌面上没有窗口，也不能判定控件不可自动化。
- **本次自动化准入尝试**：Runner 两次准备 59196 运行均在 preflight 返回 `not_admitted`，没有调用 WorkBuddy API 或创建产品任务。第一次因 `WORKBUDDY_ACCESS_TOKEN` 未设置，并发现模板中的 `access_token_env` 被凭据字段扫描误判；移除该非秘密配置项后，第二次检查同时报告 token 和工作区根目录未配置。对应原始 run JSON 未包含在本交付副本中。随后已加入 Windows DPAPI 凭据录入/读取脚本及 Documents 默认工作区；这些凭据读取和路径读写尚未实测。
- **未执行**：没有创建或触发任务，没有上传/打开测试文件，也没有回收产物。因此上述触发步骤仍是官方文档路径，不是本机产品实测。
- **路径交接方案（代码已实现，未实测）**：适配器把本轮隔离工作区绝对路径写入本地助理文本消息，等待预期产物出现且稳定，再由 Runner 归档。默认目录为当前用户 Documents 下的 `HarnessEval-WorkBuddy`，可用 `HARNESS_EVAL_WORKBUDDY_ROOT` 覆盖；每台电脑都需在 WorkBuddy 中授权。`submitted-prompt.txt` 保存实际发出的提示词，`messages.jsonl` 记录脱敏 API 元数据/回复。若 WorkBuddy 不读写该路径，改走本地任务 UIA；使用只读探测器 `node automation开发/tools/probe-workbuddy-uia.mjs` 确认目标窗口与控件后再开发 UIA worker。
- **安全注意**：本地任务需 PC 客户端运行；任务权限和模型/技能配置会影响执行条件。云端任务位于云端沙箱，不用于依赖本地工作簿的文件任务。

### 本地原型自检与桌面准入探测（2026-11-22）

- **本地合成自检**：运行 `node automation开发/connectors/workbuddy-eval/selfcheck.mjs`，退出码 0。MCP 初始化/工具列表、任务发布和输入哈希、claim、重复 claim 拒绝、提交产物路径和摘要、重复 submit 拒绝、blocked 分支及 JSONL 边界事件均通过。临时队列/产物已由脚本清理；记录见 [`selfcheck-result-2026-11-22.md`](../connectors/workbuddy-eval/selfcheck-result-2026-11-22.md)。这只是本地模拟，不是 WorkBuddy 调用。
- **当前桌面探测**：只读运行 `node automation开发/tools/probe-workbuddy-uia.mjs`，观察到 `WorkBuddy.exe` 进程 9 个、可访问顶层窗口 0、候选控件 0，结果 `no_accessible_top_level_window`。没有点击、安装、输入或创建任务。该结果只表示当前执行会话看不到可访问窗口，不能判断用户桌面或产品是否支持 Connector。
- **后续安装尝试**：用户询问能否代为安装后再次检查，发现 `WorkBuddy.exe` 进程 7 个，进程 `MainWindowTitle` 为空；UIA 结果仍为 `no_accessible_top_level_window`，可访问窗口 0。当前会话没有发现 `CodeBuddy` 进程。未点击、未修改设置、未将 Connector 装入其他产品。当前账号的产品安装状态继续记为 `unknown`。
- **结论**：本地 connector/queue 原型进入“合成自检通过”；WorkBuddy 产品连接、定时调用、工作区访问和运行记录对照仍为 `unknown`。当时 UIA 探测会话未访问到桌面窗口，故尚未按用户指南尝试安装。

## MCP Connector 队列候选（2026-11-22）

- **官方文档事实**：WorkBuddy 用户指南明确桌面客户端连接器管理页有“自定义连接器”入口，可添加自定义 MCP 服务；创建任务时也可启用连接器。开发者文档说明 Connector 支持 MCP `stdio` / HTTP / SSE，并把审核上架列为公开市场发布流程。定时任务可选择连接器、工作区、模型、技能、权限和重复规则，并查看运行记录/产物。[用户端连接器指南](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Connector) · [开发者 Connector 文档](https://open.workbuddy.cn/docs/connector) · [定时任务指南](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Automation-Guide)
- **尚未知**：当前本机客户端和账号能否保存并启动这份 stdio MCP 配置、定时任务能否稳定调用它、MCP 子进程和 WorkBuddy Agent 分别能否访问隔离工作区，以及运行记录暴露哪些调用信息。开发者市场审核上架要求不等同于桌面端自定义连接器的本地添加要求。
- **本地实现**：[`connectors/workbuddy-eval/`](../connectors/workbuddy-eval/) 已有任务合同 Schema、任务包发布脚本、stdio MCP server 与非敏感 Connector 配置模板。它尚未接入统一 Runner，也未在 WorkBuddy 中安装或调用；本地代码/协议实现不能充当产品准入通过证据。
- **拟议流程**：Runner 发布一个唯一 `run_id` 的任务包；WorkBuddy 本地定时任务周期调用 `claim_next_task`，空队列则结束；领取后处理一个 case，并调用 `submit_result` 或 `report_blocked`。MCP 服务端记录工具请求/响应和队列状态，路径仅限任务隔离工作区。重复领取不自动重新执行，状态不明时转人工恢复。
- **证据边界**：MCP JSONL 是连接器进程观察到的边界事件，不含 WorkBuddy 内部推理/原生工具轨迹。提交摘要与状态标记为 `agent_claimed`；连接器文件摘要是外部本地观察，正式正确性由评测侧独立检查。启用 Connector 后运行属于扩展环境，必须与未扩展的 WorkBuddy 结果区分。
- **Skill 决策**：暂不安装自定义 Skill。先用 MCP 结构化工具描述做 Connector-only 预实验；若调用遗漏/参数错误构成实际阻塞，再另立 Skill 干预和版本记录。
- **下一步准入顺序**：在桌面端“自定义连接器”入口粘贴本机 MCP 配置 → 用空队列调用确认服务启动 → 准备无敏感虚构小文件和临时任务包 → 验证领取、阻塞/提交和文件访问 → 创建本地定时 worker 并绑定 Connector → 对照 WorkBuddy 运行记录、MCP JSONL 与独立文件状态 → 准入后才接统一 Runner 的 enqueue/reconcile。产品步骤仍未实测，不作为正式产品结果。

## 最新实机 Connector 记录（2026-11-23）

- 首次领取调用返回 `empty`：运行中的 Connector 仍使用旧队列配置，合成任务则发布到本轮指定队列。该调用没有领取、修改或删除任务。
- 修正 Connector 队列根和工作区根后，新对话一次领取 `wb-connector-smoke-real-20261123-01`，生成 `probe.txt` 并提交。Connector JSONL 记录 `claim_next_task=claimed` 与 `submit_result=submitted`；独立读取确认产物正文、31 字节大小及 SHA-256 与提交摘要一致。结果 JSON 保留 `independent_task_verification=pending`，未改写原记录。
- 证据摘要见[WorkBuddy Connector 实机 smoke 记录](workbuddy-connector-smoke-2026-11-23.md)。原始 JSONL 与产物保存在本地烟测目录，不随交付副本分发。
- 运行报告称 WorkBuddy 版本 `5.9.2.0`，但本轮可复核文件没有版本页截图或构建元数据；此版本仍标为“报告值”。一次 smoke 不验证定时任务、模型条件、内部 Trace、批量处理或 Runner 集成。

当前准入状态：`connector_single_task_smoke=verified`；`scheduled_trigger=unknown`、`runner_enqueue_reconcile=implemented_unverified`、`open_api=not_tested`。因此下一步应验证 Runner 的队列接口；这次运行不能证明 WorkBuddy 已实现无人值守批量自动化或正式评测准入。
