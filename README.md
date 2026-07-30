# create-dpas-app

> Scaffold a **Dual-Plane Agent Stack** application — an agentic app where the
> assistant operates your product through governed capabilities, never the DOM.

```bash
pnpm create dpas-app my-agent-app
# or: npm create dpas-app@latest · yarn create dpas-app · bun create dpas-app
```

```bash
cd my-agent-app && pnpm dev
```

Open http://localhost:3000 and press **Run guided demo**. With zero
configuration — no API key, no database — a deterministic runner executes the
golden scenario through the full production pipeline:

> *“Show me the offline devices in Milan, select the visible devices, and
> disable them.”*

Filters apply, rows select, `domain:devices.disable` becomes available only
because rows are selected, a confirmation card shows the exact devices about
to be disabled, and on approval the server executes, the table reconciles,
and the Agent Inspector shows the correlated trace. Deny it, and nothing
happens — honestly reported.

## What you get

A compact, credible **device operations dashboard** demonstrating all four
DPAS layers plus a replaceable experience shell:

| Layer | Implementation | Owns |
|---|---|---|
| Presentation Capability Provider | [`@agent-surface/*`](https://www.npmjs.com/package/@agent-surface/core) | `view:*` capabilities, lifecycle, binding, confirmation |
| Domain Capability Provider | [`@orpc-agent/*`](https://www.npmjs.com/package/@orpc-agent/core) over [oRPC](https://orpc.unnoq.com) | `domain:*` procedures, policy, audit — server-authoritative |
| Agent Host | **application-owned code** in `src/agent/host/` | versioned protocol, per-turn composition, dispatch, correlation |
| Agent Runtime | [Mastra](https://mastra.ai) | planning, the agent loop, run limits |
| Experience layer | [assistant-ui](https://www.assistant-ui.com) | chat, streaming, tool & confirmation UX (replaceable) |

Plus: viewer/operator demo identity ("authority hides; state discloses"), a
developer Agent Inspector (live catalog · correlated timeline · architecture
map), light/dark themes, and a test suite that never needs a model — e2e runs
the real Mastra pipeline under a scripted `LanguageModelV2`.

Configure a live model whenever you like: set `MODEL_PROVIDER=anthropic` or
`openai` plus the matching API key in `.env`.

## CLI

```
pnpm create dpas-app [name] [options]

  -y, --yes                 accept all defaults, no prompts
      --package-manager     pnpm | npm | yarn | bun
      --model-provider      demo | anthropic | openai
      --install / --no-install
      --git / --no-git
      --example <name>      template (available: default)
  -h, --help    -v, --version
```

## This repository

```
packages/create-dpas-app/    the CLI
templates/default/           the golden app (a real, tested workspace app)
examples/generated-default/  committed generator output, drift-gated
docs/                        architecture, capability guides, ADRs
```

```bash
pnpm install
pnpm dev             # run the template app
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:e2e        # Playwright against a production build (scripted model)
pnpm test:scaffold   # generate a fresh app in /tmp and run ITS gates
```

Start with [docs/architecture.md](docs/architecture.md); decisions are in
[docs/adr/](docs/adr/). Contributions: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
