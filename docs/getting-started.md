# Getting started

> **This page:** scaffold an app, run it with no configuration, and find the four files that carry the architecture.

## Requirements

- **Node >= 22.13** (the Mastra runtime's floor).
- Any of **pnpm · npm · yarn · bun**. The CLI asks, or takes `--package-manager`.
- **No API key and no database.** Everything but the copilot runs without either.

## Scaffold

::: code-group

```bash [pnpm]
pnpm create dpas-app my-agent-app
```

```bash [npm]
npm create dpas-app@latest my-agent-app
```

```bash [yarn]
yarn create dpas-app my-agent-app
```

```bash [bun]
bun create dpas-app my-agent-app
```

:::

The CLI prompts for the project name, package manager, copilot model, dependency install and git init. `--yes` accepts every default; every prompt has a flag ([CLI reference](reference/cli.md)). Generation happens in a temp directory and is moved into place only when complete, so a failed run never leaves half a project behind, and it never writes a secret.

```bash
cd my-agent-app
pnpm dev          # http://localhost:3000
```

Two processes start: Vite for the SPA and a Hono server for `/rpc`, `/agent/chat`, `/api/*` and `/mcp`, proxied across so the client only ever uses relative paths. In production the same server serves all of it.

## What works with no key

Everything except the copilot's ability to think.

- **Filter, sort, hide columns.** All URL-synced, so a narrowed view is bookmarkable and shareable, which is the same property that makes an *agent*-narrowed view something you can look at.
- **Open a chase dialog and record a reminder.** That writes through the governed pipeline, exactly as the agent's path would.
- **Switch identity in the header.** As **Ada, the analyst**, `issue-invoice` does not grey out; it disappears. Ask the server for it directly and it answers `Capability not found`, which is what a probing caller should learn: nothing.

## Then add a key

```bash
# .env: which key you set IS the provider choice; there is no separate switch.
ANTHROPIC_API_KEY=sk-ant-...
```

Restart, press **⌘J**, and ask:

> *Which invoices are overdue, and by how much?*

Watch the order of events, because the architecture is visible in it:

1. **`domain:collections-aging`** runs on the server: a governed read, re-authorized, audited.
2. **`view:invoices.pending.setFilters`** runs *in your tab*, against the live screen. The table narrows and the URL moves with it, because the agent called the same setter the toolbar calls.
3. **`view:invoices.pending.readState`** reads the rows back, with `totalRows` alongside `rowCount` so the model can tell what it narrowed away.
4. **The answer is grounded in step 3**, and its figures match the KPI cards, because both come from one function in `capabilities/model.ts`.

Now ask it to issue a draft invoice. It will not: a model-initiated `issue-invoice` comes back as an **approval card**, and the ledger does not move until you decide. The same operation from the app's own Issue button goes through ungated: a person clicking in their own session has already expressed intent. That asymmetry is [ADR-0010](adr/0010-approvals-over-confirmations.md), and it is the decision most worth understanding here.

## The four files that carry it

| File | Why it matters |
|---|---|
| `capabilities/registry.ts` | One flat map. A key IS the capability id: the audit identity, the MCP tool name, the manifest key, and the string a policy matches on |
| `capabilities/policies.ts` | `gate-model-writes` and `analyst-hides-writes`: the two sentences that define authority |
| `app/agent/domain/manifest.ts` | The frontend's exposure ceiling. Read the comment about what is deliberately *absent* |
| `app/lib/hooks/useTableAgentComponent.ts` | A table screen's entire presentation plane, written once |

`/architecture` in the running app is a shorter version of the same tour.

## Commands in the generated app

```bash
pnpm dev            # Vite + the Hono server
pnpm test           # governance, capability contracts, the experience layer
pnpm test:e2e       # Playwright over a production build, scripted model
pnpm view:inspect   # the view plane: every capability the app can expose
pnpm view:check     # its gate: source ↔ committed contract drift
pnpm domain:inspect # the domain plane: the same inventory, runtime policies included
pnpm domain:check   # its gate: governance ↔ committed capabilities.snapshot.json
pnpm lint · typecheck · build
```

Nothing above needs a model provider or a key. See [Testing without an LLM](guides/testing.md).

## Next

- **Understand it:** [The dual-plane model](concepts/dual-plane.md) → [Anatomy of a capability](concepts/capabilities.md)
- **Extend it:** [Adding a capability](guides/adding-a-capability.md)
- **Attach a real model:** [Connecting a model](guides/connecting-a-model.md)
- **Ship it:** [Deploying](guides/deploying.md)
