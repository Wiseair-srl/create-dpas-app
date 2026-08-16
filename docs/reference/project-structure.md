# Project structure

> **This page:** where everything lives in a generated app, and what each
> directory is allowed to own.

The app is a Vite + React Router SPA served by a Hono process. In development
Vite runs the client and proxies `/rpc`, `/agent`, `/api` and `/mcp` to the
server; in production the same server serves the built SPA, so the URLs the
client uses never change.

```
capabilities/            THE domain plane: one flat registry
  registry.ts            the flat map. A key IS the capability id: the audit
                         identity, the MCP tool name, the manifest key, and
                         the string a policy matches on
  base.ts                the shared oRPC builder (meta under `agent`)
  policies.ts            gate-model-writes · analyst-hides-writes
  redact.ts              model-facing output caps (aiSdk/mcp only)
  audit.ts               target/summary decoration for the audit trail
  model.ts               the vocabulary: overdue, outstanding, ageing, cents
  schemas.ts             input schemas shared with the frontend manifest
  invoices/ clients/ reporting/     files by vertical; ids stay flat

server/
  index.ts               the Hono app: /rpc, /agent/chat, /mcp, approvals,
                         threads, session, and the static SPA
  rpc.ts                 reads plain, writes wrapped in runtime.invoke(direct)
  runtime.ts             registry + policies + approvals + audit sinks
  mastra.ts              the agent, its instructions, the model allowlist
  scripted-model.ts      the deterministic LanguageModelV2 e2e runs on
  mcp.ts                 the same capabilities over MCP
  auth.ts                demo identity, server-signed: replace this file
  db/                    the embedded JSON store: replace this file
  agent/host.ts          server half of the Agent Host
  agent/thread-store.ts  conversation persistence
  agent/audit-tap.ts     in-process audit fan-out → the live `inspector` frames

app/
  main.tsx AppRoot.tsx   composition root; the surface harness mounts this
  Shell.tsx              sidebar, header, and the docked copilot
  nav-config.ts          sections and leaves: also the agent's route list
  agent/host/            browser half: protocol, catalog, scope, dispatch,
                         settle, transport
  agent/surface/         registry, oRPC bridge, app-level capabilities
  agent/domain/          manifest: the frontend's exposure ceiling
  agent/surface/contracts.ts
                         every capability the app can expose, declared statically
  lib/hooks/useTableAgentComponent.ts
                         a table screen's whole presentation plane, once
  features/copilot/      the assistant and its experience layer
  features/invoices/     the screens
  components/            the UI kit

.agent-surface/          the compiled contract: review its diffs like API diffs
e2e/                     Playwright, production build, scripted model
docs/                    the guides that also make up this site
```

## Who may own what

**`capabilities/` owns authority.** A capability declares its own exposure,
side effect and risk. Nothing above it may widen those.

**`server/` owns identity and execution.** `auth.ts` is the only authority on
who the caller is; `rpc.ts` is the only place a UI write becomes a governed
invocation. Both are small on purpose.

**`app/agent/` owns composition, not semantics.** The host maps names, routes
calls and carries correlation ids. It never decides what a capability means or
who may call it.

**`app/features/` owns the screens.** A screen registers the capabilities that
describe *its own state*, through the setters it already has. A screen that
reaches for a DOM verb has misunderstood the plane it is on.

## The four files a real deployment replaces

1. `server/auth.ts`, the demo cookie.
2. `server/db/index.ts`, the JSON store.
3. `server/runtime.ts`: swap the in-memory approval coordinator and audit sink
   for the Postgres ones, and turn on `strict: true`.
4. `server/agent/thread-store.ts`, the JSON thread file.

Nothing above those four knows which one you chose.
