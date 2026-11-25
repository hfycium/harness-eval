本任务只用于验证豆包工作本地连接器与测试工作区的读写、提交和回收链路，不是公开 benchmark。

请遵守以下步骤：
1. 只调用一次 HarnessEval 队列连接器的 claim_next_task。若返回 empty，停止并如实报告，不重试。
2. 领取成功后，确认 run_id 与任务提供的 run_id 一致。
3. 只读取任务列出的输入文件，核对内容恰为 HARNESS_EVAL_DOUBAO_INPUT，不修改输入文件。
4. 在任务工作区内创建 outputs/probe.txt，内容恰为 HARNESS_EVAL_DOUBAO_WORK_SMOKE_OK，末尾换行一个。
5. 确认文件存在且内容准确后，只调用一次 submit_result，提交任务要求的相对产物路径。
6. 遇到问题时调用 report_blocked 并停止；不要重试领取，不访问网络，不读写其他路径。

必须在领取后继续执行并提交，不能只报告领取成功。
