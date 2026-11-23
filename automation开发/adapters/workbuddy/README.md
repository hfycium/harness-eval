# WorkBuddy adapter notes

WorkBuddy-specific Runner code remains in the parent `workbuddy.mjs` and `workbuddy-scheduler-uia.mjs` modules. The local MCP queue service remains a separate runtime package in [`automation开发/connectors/workbuddy-eval/`](../../connectors/workbuddy-eval/), because WorkBuddy starts that service as an MCP server.

## Setup Skill

[`skills/workbuddy-connector-setup/SKILL.md`](skills/workbuddy-connector-setup/SKILL.md) guides an agent through adding this project's local MCP Connector in the WorkBuddy desktop UI and verifying it with an empty queue. It is an operator/setup Skill; it is not injected into WorkBuddy benchmark tasks and cannot install itself inside WorkBuddy. This repo-local Skill is not globally registered; an agent must load it by its path or copy/install it into that agent's skill directory.

Step-by-step operator instructions are in [`install.md`](../../connectors/workbuddy-eval/install.md). The Skill references that guide and the connector package rather than duplicating their configuration.
