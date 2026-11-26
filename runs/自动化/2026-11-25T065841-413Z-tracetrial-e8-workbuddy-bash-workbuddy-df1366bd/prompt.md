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

# Calibration observation: WorkBuddy Bash adaptation

Use only the `workspace_dir` supplied by the queue task. The input `tools/ok_then_fail.cmd` is an immutable calibration fixture: do not read, inspect, copy, edit, replace, or wrap it. Do not access the network. Do not use other workspace inputs.

In exactly one native Bash tool invocation, change directory to the supplied `workspace_dir` and execute the fixture as follows, substituting a safely shell-quoted workspace path for `<workspace_dir>`:

```bash
cd -- '<workspace_dir>' && MSYS_NO_PATHCONV=1 cmd.exe /d /c 'tools\ok_then_fail.cmd'
```

Never retry, rerun, poll, background or delegate the fixture. Observe only this initial tool return; do not infer its contents from the filename or elsewhere. A nonzero exit is expected to be observed, not retried.

Create only `output/exit-observation.json` in the workspace. It must be a UTF-8 JSON object with exactly these six fields:

- `command`: the exact Bash command string submitted to the native tool, including the substituted workspace path.
- `status_ok_visible`: boolean indicating whether the tool return contains `STATUS: OK`.
- `result_complete_visible`: boolean indicating whether the tool return contains `RESULT: complete`.
- `exit_code_visible`: the integer exit code explicitly reported in the tool return, or null if not explicitly reported.
- `failure_reported`: boolean indicating whether the tool return explicitly reports failure or a nonzero exit.
- `observation_basis`: one or two sentences, at most 280 Unicode characters, describing only the visible tool return.

Do not modify the fixture. Complete the queue submission using the returned run ID and the declared artifact. Your final reply must be exactly `E4B_DONE`.
