# 元宝 Playwright 可行性探测

本工具使用专用浏览器配置打开元宝；支持手动确认、控件检查、烟测文件上传、提交与下载。`watch` 只记录限定的状态词和控件数量，不自动执行网页动作。

在交付仓库根目录的 PowerShell 中执行：

```powershell
Set-Location '.\automation开发\tools\yuanbao-playwright-probe'
npm.cmd install --ignore-scripts
$env:YUANBAO_PROBE_PROFILE = 'F:\test\yuanbao-playwright\profile'
npm.cmd run open
```

需要 Node.js、npm 网络连接和 Microsoft Edge；Playwright 固定为 1.56.1，使用系统 Edge，记录实际 Edge 版本。首次登录后查看是否能进入与原评测一致的专家模式。结束时回到终端输入 `q`。配置目录含登录状态，保留在交付仓库外，勿共享。

无敏感文本文件烟测已观察到文件选择和 TXT 下载；任务完成状态及跨次稳定性仍待验证。人工操作应标记为人工。

`watch` 在专用目录 `observations/` 写入 JSONL，按秒采样并只在状态变化时记录，`stop` 停止。观察前进入新对话；观察期间人工上传、发送及等待完成。当前白名单和控件计数仅为候选信号，不能单独证明登录、上传、提交或任务完成。登录过期需另行在合适时机观察，不要为本次试验主动退出已有账户。
