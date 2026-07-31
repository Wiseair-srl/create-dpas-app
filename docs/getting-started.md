# Getting started

> **This page:** scaffold an app, run it with no configuration, and read what the guided demo just proved.

## Requirements

- **Node >= 22.13** (the Mastra runtime's floor).
- Any of **pnpm · npm · yarn · bun** — the CLI asks, or takes `--package-manager`.
- **No API key and no database.** The generated app runs a full agent pipeline without either.

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

The CLI prompts for the project name, package manager, model provider, dependency install and git init. `--yes` accepts every default; every prompt has a flag ([CLI reference](reference/cli.md)). Generation happens in a temp directory and is moved into place only when complete, so a failed run never leaves half a project behind — and it never writes a secret.

```bash
cd my-agent-app
pnpm dev          # http://localhost:3000
```

## Run the guided demo

Open the app and press **Run guided demo** in the assistant panel. A deterministic runner executes the golden scenario through the *same* pipeline a live model uses:

> *“Show me the offline devices in Milan, select the visible devices, and disable them.”*

Watch the order of events, because the architecture is visible in it:

1. **`view:devices.filters.set`** applies the filter — a semantic capability registered by the filter component, not a synthesized click.
2. **`view:devices.table.selectRows`** selects the visible rows.
3. **`domain:devices.disable` becomes available.** It was in the catalog all along, marked unavailable with a reason (*“Select at least one device first”*). Availability is state, and state is disclosed.
4. **A confirmation card names the exact devices.** The `deviceIds` were bound from the live selection at execution time and locked — the model cannot aim this call anywhere else.
5. **On approval the server executes**, re-deriving your identity and re-validating the input as it would for any client, and writes an audit record.
6. **The table reconciles** from fresh server data — the same invalidation path a button click uses. The runner then re-reads the table and reports the *verified* outcome.

Press **Deny** instead and the model receives a typed `CONFIRMATION_INVALID` result. Nothing happens, and the assistant says so rather than claiming success.

## Look at the three things that make it a stack

**The Inspector** (assistant panel → *Inspector*) has three tabs:

- **Catalog** — every capability the model can currently see, with availability reasons, confirmation requirements and locked bindings, plus what is hidden from the current identity.
- **Timeline** — correlated events from all four layers, tied together by `turnId` and `toolCallId`. See [Tracing a tool call](guides/tracing-a-tool-call.md).
- **Map** — the topology, and the rule it encodes: one model-facing catalog never implies one execution authority.

**The identity switcher** in the header swaps two server-signed demo identities. Olivia (operator) may disable devices; Vik (viewer) may not — and for Vik `domain:devices.disable` is not greyed out, it is *absent*. **Authority hides; state discloses.** Watch the Catalog tab while switching.

**`/architecture`** in the running app is a guided tour of the same material as [Architecture](concepts/architecture.md).

## Commands in the generated app

```bash
pnpm dev          # run the app
pnpm test         # capability contracts, governance, host units — no LLM
pnpm test:e2e     # Playwright over a production build, scripted model
pnpm lint         # eslint
pnpm typecheck    # strict TypeScript
pnpm build        # production build
```

Nothing above needs a model provider or a key. See [Testing without an LLM](guides/testing.md).

## Next

- **Understand it:** [The dual-plane model](concepts/dual-plane.md) → [Anatomy of a capability](concepts/capabilities.md)
- **Extend it:** [Adding a view capability](guides/adding-a-view-capability.md) · [Adding a domain capability](guides/adding-a-domain-capability.md) · [Contextual domain actions](guides/contextual-domain-actions.md)
- **Attach a real model:** [Connecting a model](guides/connecting-a-model.md)
- **Ship it:** [Deploying](guides/deploying.md)
