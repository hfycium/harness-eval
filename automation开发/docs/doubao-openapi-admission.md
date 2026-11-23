# 豆包 OpenAPI 接入准入记录

日期：2026-11-22
状态：候选接口已发现；评测任务接入未准入；未调用产品 API

## 已有官方证据

- 豆包开放平台将“应用”和“插件”区分开：应用可在自己的服务中调用豆包 OpenAPI，官方概述举例包括发起对话和提交任务。[插件与应用说明](https://open.doubao.com/document)
- OpenAPI 通用文档以 `GET /open-apis/agent/v1/sessions/{session_id}` 演示查询会话，响应示例中的状态包括 `idle`、`in_progress`、`failed`、`requires_action`。[调用豆包 OpenAPI](https://open.doubao.com/document/store-app-development/development-configuration/call-doubao-openapi)
- 文档要求先创建应用、配置 API 权限并取得用户授权凭证；权限文档描述 `user_access_token` 用于以用户身份调用获准接口。[权限说明](https://open.doubao.com/document/store-app-development/development-configuration/request-and-manage-api-permissions)
- `dbx` 是豆包应用插件的开发 CLI；插件把 Skill/MCP 等能力装入豆包。它不等价于外部程序驱动豆包工作电脑版。[豆包 CLI 文档](https://open.doubao.com/document/plugin-docs-center/build/prepare-dev-env-dbx-cli) [插件说明](https://open.doubao.com/document)

## 尚未找到的必要接口证据

本次查阅的官方公开文档中，尚未定位到目标评测链路所需的具体接口定义：

1. 创建用于豆包办公/工作任务的会话，或向已有会话提交用户消息的 HTTP 方法、路径和请求体。
2. 如何上传 xlsx 附件，或把受控输入文件挂载到会话。
3. 如何读取任务完整状态、最终消息和过程事件。
4. 如何下载生成的 xlsx 文件并确认其工作区来源。
5. 如何锁定或读取该入口的模型、模式及 Skill 配置。
6. 上述 OpenAPI 会话是否与本项目目标“豆包工作电脑版”及其办公任务入口同一产品面。

官方总览对“发起对话、提交任务”的说明证明 API 方向值得继续核验；它没有单独证明以上端点和文件链路已经可用。会话查询端点也不能替代创建会话或提交消息端点。

## 适配决定

当前不新增可运行的 `doubao_openapi.mjs`，也不注册豆包适配器。现有 Runner 只支持启动并等待 CLI 子进程，不能代表 API 流程已经接通；配置一个 URL 或占位 HTTP 请求会造成伪接入。

准入前置条件：取得并核对官方接口定义；确认目标产品入口和账号权限；用非正式、无敏感内容的小文件完成一次端到端验证，证明输入、提交、状态观测及产物回收；记录模型/模式字段是否存在。真实 API 调用需在授权和凭据可用后另行执行，本记录没有调用接口。

若端点和文件链路经官方文档/权限确认，下一步应实现独立 HTTP 会话适配器，支持授权状态检查、会话/消息提交、轮询或事件读取、权限交互、产物下载和凭据脱敏；不要把该流程包装成 CLI 进程适配器。

## 本次验证范围

- 仅检索豆包官方开放平台文档并阅读本仓库现有适配器契约。
- 未登录开发者平台、未申请应用权限、未调用任何 Doubao API、未使用凭据、未运行安装脚本。
- 这是静态准入结论，不是产品实测。
