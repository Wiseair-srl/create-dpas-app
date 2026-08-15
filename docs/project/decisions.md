# Decision records

> **This page:** the architectural decisions behind the scaffolder and the app it generates: what was chosen, and what it was chosen *against*.

## The two that explain the architecture

Worth reading even if you never change the template. Between them they answer "why is there a host layer at all" and "why is a dangerous operation shaped the way it is".

| ADR | Decision | Why it matters |
|---|---|---|
| [0010](../adr/0010-approvals-over-confirmations.md) | Consequence is gated by a **server approval**, not a frontend confirmation | *Bind for context, gate for consequence*: the rule that decides how every consequential operation is exposed, and the one mistake the template is built to make obvious |
| [0002](../adr/0002-host-protocol-over-react-ai-sdk.md) | An **application-owned host protocol** instead of `@assistant-ui/react-ai-sdk` | Why the Agent Host is code you can read. Everything in [Host protocol](../reference/host-protocol.md) follows from it |

## All records

| ADR | Status | Decision | Why it matters |
|---|---|---|---|
| [0001](../adr/0001-published-dpas-packages.md) | accepted | Consume **published** `@agent-surface/*` and `@orpc-agent/*` | Generated apps depend on npm versions, not a workspace layout that cannot be scaffolded |
| [0002](../adr/0002-host-protocol-over-react-ai-sdk.md) | accepted | An **application-owned host protocol** | Avoids an `ai@5` / `ai@7` split-brain, and makes composition, dispatch and correlation code you can read |
| [0003](../adr/0003-ai-sdk-v5-line.md) | accepted | Pin the AI SDK to the **v5 line** | `@orpc-agent/ai-sdk` peers on `ai@^5`; the host protocol isolates the browser from this choice |
| [0004](../adr/0004-embedded-json-store.md) | accepted | A **JSON file store**, not SQLite | Zero native dependencies (the most common `create-*` install failure), and state survives restarts |
| [0005](../adr/0005-confirmation-wait-between-steps.md) | accepted · amended | Confirmation mode `wait`, executed **between protocol steps** | A human decision never holds a streaming response open |
| [0006](../adr/0006-scripted-model-for-live-path-ci.md) | accepted | A **scripted `LanguageModelV2`** for the live path in CI | The whole production pipeline is tested with zero credentials |
| [0007](../adr/0007-demo-identity-signed-cookie.md) | accepted | Demo identity as a **server-signed cookie** | Roles are never read from a request body or tool input; one file is the seam for real auth |
| [0008](../adr/0008-runtime-model-credentials.md) | **superseded** | A model key could be **connected from the browser** | The feature is gone. Kept for why a single shared process makes that dangerous |
| [0009](../adr/0009-orphaned-server-tool-calls.md) | accepted | The host **answers server tool calls the runtime leaves open** | Found with a live model, not by tests: a batched call otherwise strands the UI and malforms the model's history |
| [0010](../adr/0010-approvals-over-confirmations.md) | accepted | Consequence is gated by a **server approval** | A contextual binding reaches the server as a *direct* call, so binding a dangerous operation quietly weakens it |
| [0011](../adr/0011-compiled-capability-contracts.md) | accepted | The agent surface is **compiled from source**, not discovered at runtime | "What can the model do in this app" stops being a question only a running app can answer |

## Adding one

Architectural decisions get an ADR in `docs/adr/`, numbered sequentially, with the same shape: **Status · Context · Decision · Consequences**. Add it to the table above and to the sidebar in `docs/.vitepress/config.ts`.

A decision that replaces an earlier one does not delete it: set the old record's status to `superseded`, and open it with what replaced it and what is still worth reading. [ADR-0008](../adr/0008-runtime-model-credentials.md) is the worked example. See [Contributing](contributing.md).
