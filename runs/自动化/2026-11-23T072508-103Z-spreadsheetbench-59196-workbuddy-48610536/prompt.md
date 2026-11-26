# WorkBuddy HarnessEval execution contract

# WorkBuddy HarnessEval task execution

Runner injects this Skill into the task returned by `claim_next_task`. The task is already claimed. A successful claim is the start of work, not a completed response.

## Required sequence

1. Do not call `claim_next_task` again. Verify the returned `run_id` and `case_id` are present. Continue processing that exact task in the same execution turn. **Do not stop after summarizing the claim, ask whether to continue, or wait for another user message.**
2. Use only the returned `workspace_dir`, declared input paths, and expected artifact paths. Treat inputs as read-only unless the task explicitly permits changes. Do not search for answer files, evaluator files, credentials, or unrelated user data; do not access the network.
3. Follow the returned task prompt. Before submission, check that each required artifact exists at its declared path and that the original inputs were preserved when required.
4. When all required artifacts are ready, call `submit_result` exactly once with the same `run_id` and the declared artifact paths. Wait for the tool response before reporting completion.
5. If the task cannot be completed safely because of missing files, permissions, tool failure, or another blocker, call `report_blocked` exactly once for the claimed `run_id`, explain the observed blocker, and do not retry or claim another task.

## Stop conditions

- The initial trigger handles `empty`: report no task and stop.
- This Skill applies after a successful `claimed` result: proceed through the task and end only after `submit_result` or `report_blocked` returns.
- Mismatched or incomplete task identity: do not touch files; report the mismatch as blocked if the claimed run can be identified.
- Unknown tool result or lost submission response: do not claim again and do not submit a duplicate. Report the uncertainty for operator reconciliation.

## Final response

Report the run ID, Connector result (`submitted` or `blocked`), artifact paths, and any observed blocker. A narrative saying that work is complete does not replace `submit_result`.

---

# Case task prompt

# SpreadsheetBench 任务输入（未提交）

来源任务：SpreadsheetBench `sample_data_200`，任务 ID `59196`，类型 `Cell-Level Manipulation`。

原始任务说明：

> I need a formula to determine which column contains the highest value in a row, and then return the heading of that column. My Excel sheet example is attached.

请基于该任务附带的输入工作簿，在 `H3:H5` 填入对应公式，并将完成后的工作簿另存为 `outputs/59196_output.xlsx`。不要覆盖输入文件。完成后说明产物路径。

输入文件：`inputs/sample_data_200/spreadsheet/59196/1_59196_input.xlsx`

本提示只补充公开数据元信息中的答案位置 `H3:H5` 和文件交付要求，不包含官方答案内容；尚未提交给任何产品。
