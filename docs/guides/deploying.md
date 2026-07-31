# Deploying

> **This page:** what the generated app deliberately leaves as a demo, and what to replace before anyone but you uses it. The app is a real Next.js application — the deployment story is ordinary; the seams are the interesting part.

## The four seams

Each of these is one file, chosen so that replacing it touches neither capability plane.

### 1. Identity — `src/server/auth/session.ts`

The app ships a **demo identity system**: a server-signed cookie carrying one of two demo users, verified on every request. It is not authentication — there is no login, and the default signing secret is in the repository.

Replace this module with your auth provider. Everything downstream consumes only `resolveSession` and the `Session` type, and role claims from request bodies or tool inputs are never read anywhere — that property is what makes the swap safe. Until you replace it, at minimum set `AUTH_SECRET` to a real value ([ADR-0007](../adr/0007-demo-identity-signed-cookie.md)).

### 2. Storage — `src/server/db/`

An embedded JSON store: state in memory, written through to `.data/db.json` so mutations survive a restart ([ADR-0004](../adr/0004-embedded-json-store.md)). The oRPC procedures are its only callers, so swapping in a real database is a change to this directory alone. `DPAS_DATA_DIR` relocates the file (tests and CI use it).

It is a single-process store: it will not survive serverless scale-out or multiple instances.

### 3. Audit — `src/server/audit/log.ts`

A bounded in-memory ring (500 entries) with two producers — the procedures' authoritative domain records and the oRPC Agent governance events — and one subscriber, the chat route forwarding to the Inspector. **In-memory means gone on restart.** Point `record` at your telemetry pipeline, and register the runtime's sink in `src/server/agent/runtime.ts`.

### 4. Model credentials — `.env`, not the UI

Set `MODEL_PROVIDER` and the matching key in the environment ([Configuration](../reference/configuration.md)). Runtime key entry from the assistant panel is **disabled in production builds** on purpose: one process would share one visitor's key with everyone. `ALLOW_RUNTIME_MODEL_KEY=true` opts a genuinely single-user deployment back in ([ADR-0008](../adr/0008-runtime-model-credentials.md)).

## Build and run

```bash
pnpm build
pnpm start        # next start
```

Node >= 22.13. No build-time secrets: nothing model-related is read outside route handlers, and no key ever reaches `NEXT_PUBLIC_*`.

## Pre-flight checklist

| Check | Why |
|---|---|
| `AUTH_SECRET` set to a real secret, or real auth wired in | the default is public |
| The identity switcher removed or restricted | it re-signs a cookie for either demo user by design |
| A durable store behind `src/server/db/` | the JSON file is one process's disk |
| Audit records forwarded somewhere durable | the ring buffer is bounded and volatile |
| `MODEL_PROVIDER` + key in the environment | the UI path stays off in production |
| `ALLOW_RUNTIME_MODEL_KEY` unset (or `false`) | unless the deployment is single-user |
| Exposure reviewed: every `expose.aiSdk: true` | it is the whole model-visible domain surface |
| Every `sideEffect` / `risk` still honest | they drive UI treatment and human review |
| The surface snapshot diffed | it is your agent-facing API |

## What does not change when you deploy

The governance properties are not development conveniences — they are the same code in production: deny-by-default exposure on both planes, server re-authorization of every domain call, single-use input-bound confirmations, one model-visible path per operation, and correlated audit on both planes. See [Security and confirmation](../security/model.md).
