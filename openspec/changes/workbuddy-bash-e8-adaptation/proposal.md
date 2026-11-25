# WorkBuddy Bash 执行适配

WorkBuddy 的 Bash 工具调用不共享工作目录；用户提供的对照显示 MSYS 参数转换可能干扰 CMD 的 `/d /c`。为此增加独立 E8 Bash 适配题，不修改原题或共用 Connector。该题只用于验证同一次调用内的目录设置、CMD 执行和产物回收。
