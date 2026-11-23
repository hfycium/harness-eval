# Codex CLI 登录诊断

日期：2026-11-22

## 核查结果

- 当前执行身份：隔离自动化沙箱账户（具体用户名已脱敏）。
- 当前进程未设置 `CODEX_HOME`。
- `Get-Command codex -All` 的首个解析结果为 `codex.ps1`，随后才是 `codex.cmd`。
- 在当前 PowerShell 执行策略下，直接运行 `codex login status` 会因 `.ps1` 脚本被禁止而失败；这是命令解析/执行策略问题，不是登录状态本身。
- 显式运行 `codex.cmd login status` 可正常查询，结果为 `Not logged in`。
- 显式运行 `codex.cmd --version` 返回 `codex-cli 0.171.0`。
- Codex 适配器配置模板将入口设为 `codex.cmd`，并使用 `codex exec --json --sandbox workspace-write --ephemeral`；参见 `configs/codex.example.json` 与 `adapters/codex.mjs`。

## 结论边界

已确认：当前自动化执行环境里的 Codex CLI 未登录；PowerShell 的裸 `codex` 命令还会先遇到脚本执行策略限制。

未确认：用户交互式桌面会话或其他 Windows 用户下的 Codex CLI 是否已登录；当前身份是否有可复用的用户级登录凭据；未设置 `CODEX_HOME` 也不能单独证明默认配置目录中没有凭据。没有读取、打印、复制或修改任何凭据文件。

## 下一步

需要在希望运行评测的真实 Windows 用户交互终端中完成一次官方 CLI 登录，然后在**同一个用户、同一终端环境、同一 `CODEX_HOME`** 下验证：

```powershell
codex.cmd login
codex.cmd login status
```

若自动化仍以隔离沙箱身份启动，它不会自动继承另一个 Windows 用户的登录态。应让自动化和登录验证在同一用户上下文运行；不要复制 `auth.json` 或在日志中输出令牌。登录成功后，再用同一 CLI 入口执行 `codex exec` 的最小无副作用探针。

## 可复核命令

```powershell
whoami
Get-Command codex -All | Select-Object CommandType,Source,Name
$env:CODEX_HOME
codex.cmd login status
codex.cmd --version
```
