# Decision records

> **This page:** the architectural decisions behind the scaffolder and the app it generates — what was chosen, and what it was chosen *against*. All are accepted.

| ADR | Decision | Why it matters |
|---|---|---|
| [0001](../adr/0001-published-dpas-packages.md) | Consume **published** `@agent-surface/*` and `@orpc-agent/*` | Generated apps depend on npm versions, not a workspace layout that cannot be scaffolded |
| [0002](../adr/0002-host-protocol-over-react-ai-sdk.md) | An **application-owned host protocol** instead of `@assistant-ui/react-ai-sdk` | Avoids an `ai@5` / `ai@7` split-brain, and makes composition, dispatch and correlation code you can read |
| [0003](../adr/0003-ai-sdk-v5-line.md) | Pin the AI SDK to the **v5 line** | `@orpc-agent/ai-sdk` peers on `ai@^5`; the host protocol isolates the browser from this choice |
| [0004](../adr/0004-embedded-json-store.md) | A **JSON file store**, not SQLite | Zero native dependencies — the most common `create-*` install failure — and state survives restarts |
| [0005](../adr/0005-confirmation-wait-between-steps.md) | Confirmation mode `wait`, executed **between protocol steps** | A human decision never holds a streaming response open |
| [0006](../adr/0006-scripted-model-for-live-path-ci.md) | A **scripted `LanguageModelV2`** for the live path in CI | The whole production pipeline is tested with zero credentials |
| [0007](../adr/0007-demo-identity-signed-cookie.md) | Demo identity as a **server-signed cookie** | Roles are never read from a request body or tool input; one file is the seam for real auth |
| [0008](../adr/0008-runtime-model-credentials.md) | A model key may be **connected from the UI**, in server memory only | Instant first experience without a secret reaching the browser or the disk |
| [0009](../adr/0009-orphaned-server-tool-calls.md) | The host **answers server tool calls Mastra leaves open** | Found with a live model, not by tests: a batched call otherwise strands the UI and malforms the model's history |

## Reading them

Each record states its context, the options considered, the decision, and its consequences. Two are worth reading even if you never change the template:

- **[ADR-0002](../adr/0002-host-protocol-over-react-ai-sdk.md)** explains why the Agent Host is application code. Everything in [Host protocol](../reference/host-protocol.md) follows from it.
- **[ADR-0009](../adr/0009-orphaned-server-tool-calls.md)** is the one that came from production behaviour rather than design — a useful reminder of what a real model does that a test suite did not.

## Adding one

Architectural decisions get an ADR in `docs/adr/`, numbered sequentially, with the same shape: **Status · Context · Decision · Consequences**. Add it to the table above and to the sidebar in `docs/.vitepress/config.ts`. See [Contributing](contributing.md).
