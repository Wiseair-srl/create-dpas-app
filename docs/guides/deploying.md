# Deploying

> **This page:** what the generated app deliberately leaves as a demo, and what to replace before anyone but you uses it. The deployment story is ordinary — one Node process; the seams are the interesting part.

## Build and run

```bash
pnpm build        # vite build → dist/, then esbuild → build/index.mjs
pnpm start        # node build/index.mjs
```

Node >= 22.13. One process serves the SPA, `/rpc`, `/agent/chat`, `/api/*` and `/mcp`; `PORT` says where. Every npm dependency stays external to the server bundle — only the app's own TypeScript is bundled — so `node_modules` ships alongside it as usual.

No build-time secrets: the agent loop runs server-side, so nothing model-related is ever read in client code and no key can reach the bundle.

## The four seams

Each is one file, chosen so replacing it touches neither capability plane.

### 1. Identity — `server/auth.ts`

A **demo identity system**: a server-signed cookie carrying one of two demo users, verified on every request. It is not authentication — there is no login, and the default signing secret is in the repository.

Replace this module with your auth provider. Everything downstream consumes only `SessionUser` and `sessionFromRequest`, and role claims from request bodies or tool inputs are never read anywhere — that property is what makes the swap safe. Delete the `POST /api/session` role switcher with it; it exists to re-sign a cookie as either demo user, which is a demo feature and nothing else. Until you replace all of it, at minimum set `AUTH_SECRET` ([ADR-0007](../adr/0007-demo-identity-signed-cookie.md)).

### 2. Storage — `server/db/index.ts`

An embedded JSON store: state in memory, written through to `.data/db.json` so mutations survive a restart ([ADR-0004](../adr/0004-embedded-json-store.md)). The capabilities call its exported functions and nothing else, so swapping in Postgres and Drizzle is a change to this file alone. `DPAS_DATA_DIR` relocates it (tests and CI use that).

It is a single-process store: it will not survive serverless scale-out or multiple instances.

### 3. Approvals and audit — `server/runtime.ts`

Both are in-memory, and both say so:

```ts
approvals: { coordinator: createInMemoryApprovalCoordinator() },
audit:     { sinks: [decorateSink(getAuditLog().sink)], strict: false },
```

A restart forgets pending approvals, and the audit tap is a bounded, lossy in-process fan-out that feeds the live `inspector` frames — not a record. Swap in `createPgApprovalCoordinator({ query })` and `createPgAuditSink({ query })` from `@orpc-agent/postgres`, and turn on `strict: true`. Strict mode is the setting that guarantees **audit before effect**, which is a promise only a durable sink can keep — turning it on with the in-memory sink would be a claim the deployment cannot honour.

### 4. Conversations — `server/agent/thread-store.ts`

A JSON file with a 50-thread cap. Mastra Memory over Postgres drops in behind the same four functions (`persistStep`, `listThreads`, `getThread`, `deleteThread`). Note the comment at the top before you do: the agent must not *recall* through memory, or every message reaches the model twice — the protocol already carries the conversation.

## Pre-flight checklist

| Check | Why |
|---|---|
| `AUTH_SECRET` set to a real secret, or real auth wired in | the default is public |
| The identity switcher removed | it re-signs a cookie for either demo user by design |
| A durable store behind `server/db/` | the JSON file is one process's disk |
| A durable approval coordinator, and `strict: true` | a forgotten approval is a lost decision |
| Audit forwarded somewhere durable | the tap is bounded and volatile |
| `/mcp` put behind real authorization | it currently trusts the same demo cookie |
| A provider key in the environment | there is no runtime key-entry path any more |
| Exposure reviewed: every `expose.aiSdk: true` | it is the whole model-visible domain surface |
| `GATED_CAPABILITIES` reviewed | anything irreversible or externally visible belongs there |
| Every `sideEffect` / `risk` still honest | they drive policy, UI treatment and review |
| The surface baseline diffed | it is your agent-facing API |

## What does not change when you deploy

The governance properties are not development conveniences — they are the same code in production: deny-by-default exposure on both planes, server re-authorization of every domain call, bound inputs removed from the advertised schema, approvals for consequential operations, one model-visible path per operation, and correlated audit across both planes. See [Security model](../security/model.md).
