# Project structure

> **This page:** where everything lives in a generated app, and what each directory is allowed to own.

```
src/
  features/devices/        the feature: components register their own view
    components/            capabilities next to the state they describe;
    capabilities/          devices-table.tsx also binds the contextual
    domain/manifest.ts     domain reference (the frontend exposure ceiling)
    queries/               React Query hooks over the oRPC client
    schemas/               shared zod schemas
  server/
    orpc/procedures.ts     THE domain operations (UI, agent, tests — one code path)
    orpc/router.ts         the router; a procedure's path is its capability id
    agent/runtime.ts       oRPC Agent governance: registry, policies, audit sink
    auth/session.ts        demo identity (viewer/operator), server-signed
    audit/log.ts           bounded audit ring, subscribable
    db/                    zero-config embedded JSON store
    model-config.ts        runtime model key, process memory only
  agent/
    surface/               Agent Surface registry + oRPC bridge (browser half)
    host/                  the Agent Host — see below
    runtime/               Mastra agent, instructions, run limits, scripted model
    experience/            assistant-ui adapter, tool renderers, confirmation card
    demo/scenario.ts       the deterministic guided demo
    inspector/             trace store for the Agent Inspector
  components/              app shell, UI primitives, assistant panel, inspector UI
  app/                     Next.js routes: /dashboard, /architecture, /api/*
e2e/                       Playwright specs (production build, scripted model)
docs/                      the guides that also make up this site
```

## The Agent Host, file by file

`src/agent/host/` is application code, not framework glue — the layer that keeps the two providers from owning each other:

| File | Owns |
|---|---|
| `protocol.ts` | The versioned wire contract: request schema, NDJSON frames, host error codes |
| `catalog.ts` | Browser-side projection of the live surface into wire descriptors |
| `wire-names.ts` | Canonical id ↔ provider-safe wire name, both planes, one convention |
| `client-dispatch.ts` | Routing a model tool call to the Agent Surface executor |
| `surface-settle.ts` | Waiting for React to commit what a call changed, before the next catalog is projected |
| `transport-client.ts` | The browser half of the loop: snapshot → post → stream → execute → settle → repeat, plus run limits |
| `server-compose.ts` | The server half: catalog composition, collision rejection, one Mastra run, frame emission |
| `identity.ts` | Conversation, turn and step ids |
| `errors.ts` | The single result envelope the model reads back |

Details in [Host protocol](host-protocol.md).

## Ownership rules worth keeping

- **A capability lives with the state it describes.** View capabilities are registered by the component that owns the state — not in a central registry file. One owner per capability.
- **`src/server/orpc/procedures.ts` is the only place a domain operation exists.** The dashboard, the agent and the tests all call it. There is no agent-specific backend.
- **`src/features/*/domain/manifest.ts` is a ceiling, not a route.** A component cannot contextually reference a procedure the manifest does not list.
- **Nothing outside `src/server/` reads a secret.** Model keys are read in route handlers only; `NEXT_PUBLIC_*` never carries one.
- **The host never decides capability semantics**, and neither provider knows about the other. Mastra consumes what the host composed.

## This repository (the scaffolder)

```
packages/create-dpas-app/    the CLI
templates/default/           the golden app — a real, tested workspace member
examples/generated-default/  committed generator output, drift-gated in CI
docs/                        this documentation + ADRs
scripts/                     example regen/drift check + scaffold smoke test
```

See [Repository and gates](../project/repository.md).
