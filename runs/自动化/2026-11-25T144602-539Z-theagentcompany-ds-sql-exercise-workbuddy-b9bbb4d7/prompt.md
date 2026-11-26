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

As our first data scientist intern, we designed a simple SQL exercise for you to help you get your hands dirty.

You are provided with a SQL database containing product data. Write three SQL queries to analyze the data and write the answer in 3 txt files, one for each task (file names should be task1.txt, task2.txt, task3.txt, respectively). The txt files should be placed in the current workspace directory. The exercise database is located at inputs/database.db. You can access it using an available SQLite tool.

Task 1: Find the total number of products in the database
Task 2: Find how many different product categories exist
Task 3: Find the top 3 most expensive products in the Electronics category. Show only product name and price in each line (e.g.
"A", 123.45,
"B", 12.34,
"C", 1.23
) with two digits
