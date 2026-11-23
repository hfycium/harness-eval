---
name: workbuddy-connector-setup
description: Install and verify this project's local HarnessEval MCP queue connector in the WorkBuddy desktop app. Use for connector setup only; it does not configure benchmark runs or inject a WorkBuddy task Skill.
---

# WorkBuddy Connector setup

Use this Skill when the user asks to install or verify the local HarnessEval queue Connector in WorkBuddy.

## References

- Follow the exact desktop steps and MCP JSON shape in [`automation开发/connectors/workbuddy-eval/install.md`](../../../../connectors/workbuddy-eval/install.md).
- Connector code and its queue contract are in [`automation开发/connectors/workbuddy-eval/`](../../../../connectors/workbuddy-eval/).
- WorkBuddy UIA automation is in `automation开发/tools/workbuddy-scheduler-uia.ps1`; do not use its task-creation actions for Connector installation.

## Workflow

1. Confirm the target is the WorkBuddy desktop app. A CodeBuddy MCP setting affects CodeBuddy itself unless it can directly operate the WorkBuddy window.
2. Read the installation guide. Use the WorkBuddy UI's **Expert → Skills → Connectors → Custom Connector** route and add the local stdio MCP configuration there. Do not edit undocumented WorkBuddy config files or its database.
3. Use two dedicated, separate directories outside the project repository for the queue root and authorized workspace root. Keep case oracles, scores, credentials, and real user data out of both directories.
4. Preserve the existing Connector and MCP settings. Add only the `harness-eval-task-queue` server. If the UI is unavailable, required paths are missing, or WorkBuddy rejects the config, stop and report the exact observed blocker; do not guess selectors, weaken permissions, or switch to an undocumented API.
5. After the UI reports the Connector connected, use a normal WorkBuddy conversation with only the empty-queue check from the installation guide. Do not publish a benchmark case or invoke file-processing tasks during this check.
6. Confirm that `claim_next_task` returns `empty` and that `queue/events/connector.jsonl` records the request and response. Record WorkBuddy version, connector connection state, MCP startup/error evidence, and whether the empty-queue tool call was observed. Never record tokens or secrets.
7. Report the result as one of: `connected_empty_queue_verified`, `blocked`, or `unknown`. This check does not verify scheduled-task binding, workspace file access, artifact correctness, or WorkBuddy internal traces.

## Boundaries

- This is an operator Skill stored with the WorkBuddy adapter. It is not the optional runtime Skill shipped to or activated inside a WorkBuddy task.
- Do not create a schedule or run a benchmark task unless the user separately requests that step.
- MCP server JSONL proves only the connector process's boundary calls. It does not reveal WorkBuddy reasoning or native tool traces.
- If a live WorkBuddy window cannot be accessed by the current execution session, do not claim installation. Give the user the documented UI steps and retain the product status as unverified.
