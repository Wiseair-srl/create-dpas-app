---
"create-dpas-app": minor
---

The template closes the approval loop over MCP, on orpc-agent 3.0. A gated write suspended from an MCP session now carries a deep link to a new `/approvals/:id` approver page (`APP_URL` names the origin), where a human decides inside the app; the session then executes the approved operation itself through the adapter's opt-in `approvals_resume` tool, which the runtime binds to that session's actor and surface. The decision endpoint accordingly resumes only records suspended in the app's own loop and leaves an MCP record for its requester, since resuming it server-side would consume it out from under the session that asked. Deciding remains impossible over MCP.
