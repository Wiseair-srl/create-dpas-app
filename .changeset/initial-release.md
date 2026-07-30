---
"create-dpas-app": minor
---

Initial release: scaffold a Dual-Plane Agent Stack application.

Generates a device operations dashboard demonstrating all four DPAS layers —
Agent Surface (`view:*`), oRPC Agent (`domain:*`), an application-owned Agent
Host with a versioned browser/server protocol, and Mastra — with assistant-ui
as the replaceable experience layer. The generated app runs a deterministic
guided demo of the golden scenario with zero configuration, and ships
contract tests, Playwright e2e (including a credential-free live-pipeline
run), docs, and an Agent Inspector.
