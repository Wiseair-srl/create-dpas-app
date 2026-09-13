# create-dpas-app

> Scaffold a **Dual-Plane Agent Stack** application: an agentic app where the
> assistant operates your product through governed capabilities, never the DOM.

```bash
pnpm create dpas-app my-agent-app
# or: npm create dpas-app@latest · yarn create dpas-app · bun create dpas-app
```

```bash
cd my-agent-app && pnpm dev
```

Open http://localhost:3000. You get a working **receivables console**: a
ledger, three screens, a docked copilot (⌘J), an MCP endpoint and a governed
approval flow, with no database, no API key and no configuration.

## The idea

Two planes of capabilities, never blurred:

|          | `view:*` (presentation)                                                                      | `domain:*` (authoritative)                                                             |
| -------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Meaning  | what the open screen can do                                                                  | operations valid with no UI at all                                                     |
| Owner    | [Agent Surface](https://www.npmjs.com/package/@agent-surface/core), registered by components | [oRPC Agent](https://www.npmjs.com/package/@orpc-agent/core) over real oRPC procedures |
| Executes | in this browser tab                                                                          | on the server, re-authorized every call                                                |

And the rule that decides how a consequential operation is exposed:

> **Bind for context. Gate for consequence.**

A contextual reference binds the live screen's target and removes it from the
model's input schema. Consequential operations can require server approval.
The distributed integration supports both on the same operation: contextual
model calls use the governed agent gateway and retain their approval policy.
The local starter demonstrates separate contextual and gated operations.

## What you get

| Layer                     | Implementation                                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Presentation capabilities | [`@agent-surface/*`](https://www.npmjs.com/package/@agent-surface/core): one hook registers a table's whole plane                                         |
| Domain capabilities       | [`@orpc-agent/*`](https://www.npmjs.com/package/@orpc-agent/core) over [oRPC](https://orpc.unnoq.com): deny-by-default exposure, policy, approvals, audit |
| Agent Host                | `create-dpas-app/host` integration modules plus application auth, transport and run ownership                                                             |
| Runtime                   | [Mastra](https://mastra.ai): reasoning loop, memory and native suspension                                                                                 |
| Experience                | [assistant-ui](https://www.assistant-ui.com): docked, resizable, thread history                                                                           |
| Second adapter            | an **MCP** endpoint over the same registry, proving it is transport-agnostic                                                                              |

Plus: a demo identity switcher that shows authority _hiding_ rather than
refusing, a committed surface baseline you diff like an API, and a test suite
that never needs a model: e2e runs the entire live pipeline under a scripted
`LanguageModelV2`.

Stack: Vite + React Router on a Hono server, one process in production.

## Existing projects and separate deployments

Install `create-dpas-app` to use `/host`, `/host/mastra`, `/host/postgres` and
`/host/transport` inside an existing application. The package includes a
three-process reference with a stateless backend, Mastra host and browser.
See the [distributed integration guide](docs/guides/distributed.md) for
authentication, durable receipts, approval continuation and recovery limits.

## CLI

```
pnpm create dpas-app [name] [options]

  -y, --yes                 accept all defaults, no prompts
      --package-manager     pnpm | npm | yarn | bun
      --install / --no-install
      --git / --no-git
      --example <name>      template (available: default)
  -h, --help    -v, --version
```

## This repository

```
packages/create-dpas-app/    CLI, host kit and distributed reference
templates/default/           the golden app (a real, tested workspace app)
examples/generated-default/  committed generator output, drift-gated
docs/                        the documentation site (VitePress) + ADRs
```

```bash
pnpm install
pnpm dev             # run the template app
pnpm docs:dev        # the documentation site, with hot reload
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:e2e        # Playwright against a production build (scripted model)
pnpm test:scaffold   # generate a fresh app in /tmp and run ITS gates
pnpm test:distributed # packed host kit against published domain/browser libraries
```

Start with [docs/getting-started.md](docs/getting-started.md) and
[the dual-plane model](docs/concepts/dual-plane.md); decisions are in
[docs/adr/](docs/adr/). The guides that ship inside every generated app live in
`templates/default/docs/` and are included by the site, so the two can't drift.
Contributions: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
