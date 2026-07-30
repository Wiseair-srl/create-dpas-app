# create-dpas-app — implementation report

Date: 2026-07-30 · Status: complete, all gates green

## 1. Architecture summary

`create-dpas-app` scaffolds a **Dual-Plane Agent Stack** application. The
generated app is a device operations dashboard whose assistant operates the
product through governed capabilities rather than the DOM.

Two capability planes, never blurred:

- **`view:*` — presentation plane.** Owned by **Agent Surface**. Capabilities
  are registered by the components that own the state (filters, table,
  drawer, navigation), exist only while mounted, validate input, disclose
  availability with reasons, and reject stale invocations. Executes in the
  browser.
- **`domain:*` — authoritative plane.** Owned by **oRPC Agent** over real oRPC
  procedures. Deny-by-default exposure per surface, policy evaluation,
  validation, audit, error sanitization. Executes on the server, re-authorized
  every call.

`domain:devices.disable` is the architectural centerpiece: it is **not** a
direct model tool (`expose.aiSdk: false`). Its only model-visible path is a
*contextual reference* declared by the table component — hidden without the
permission, unavailable until rows are selected, `deviceIds` bound from the
live selection and locked, and gated by a single-use, input-bound
confirmation. One operation, one canonical identity, one execution path.

Between them sits the **Agent Host** — explicit application modules
(`src/agent/host/`), not route glue: a versioned browser↔server protocol,
per-turn catalog composition, duplicate-path rejection, canonical-id ↔
wire-name mapping, executor routing, correlation ids, typed transport errors,
and run limits. **Mastra** owns only the reasoning loop; **assistant-ui**
renders the conversation behind a one-file adapter and is genuinely
replaceable.

## 2. Repository tree

```
create-dpas-app/
├── packages/create-dpas-app/        the published CLI
│   ├── src/{index,args,pm,scaffold,steps,validate}.ts
│   ├── src/cli.test.ts              11 unit tests
│   └── scripts/sync-template.mjs    bundles the template for npm
├── templates/default/               the golden app (79 files, ~7.3k lines)
│   ├── src/agent/
│   │   ├── host/                    protocol · catalog · wire-names ·
│   │   │                            client-dispatch · transport-client ·
│   │   │                            server-compose · identity · errors · toolset
│   │   ├── surface/                 registry (+ oRPC bridge) · wiring · schema
│   │   ├── runtime/                 mastra · instructions · scripted-model
│   │   ├── experience/              runtime-adapter · tool-renderers ·
│   │   │                            confirmation-card · message-store · turn-controller
│   │   ├── demo/scenario.ts         deterministic golden scenario
│   │   └── inspector/               trace store
│   ├── src/server/                  orpc/{procedures,router,context} ·
│   │                                agent/runtime · auth/session · db · audit
│   ├── src/features/devices/        components (with their capability
│   │                                registrations) · schemas · queries · domain manifest
│   ├── src/components/              app-shell · ui · assistant · agent-inspector
│   ├── src/app/                     (app)/dashboard · (app)/architecture ·
│   │                                api/{chat,orpc,auth,agent,config}
│   ├── e2e/                         7 spec files, 17 tests
│   └── docs/                        6 guides shipped with every app
├── examples/generated-default/      107 files, drift-gated in CI
├── docs/                            architecture · guides · 7 ADRs · this report
├── scripts/                         regen-example · check-example-drift · scaffold-smoke
└── .github/workflows/               ci.yml · release.yml
```

## 3. Dependency versions and why

Verified against npm and the local `agent-surface` / `orpc-agent` checkouts on
2026-07-30.

| Package | Version | Why this one |
|---|---|---|
| `@agent-surface/{core,react,orpc,testing}` | 0.1.0 | the presentation-plane reference implementation; published, identical to local source (ADR-0001) |
| `@orpc-agent/{core,ai-sdk,testing}` | 1.0.0 | the domain-plane reference implementation, 1.0 with strict semver |
| `@orpc/{server,client,tanstack-query}` | 1.14.13 | satisfies orpc-agent's `^1.14.10` peer |
| `@mastra/core` | 1.54.0 | agent runtime; provider-version agnostic, accepts `ai@5` tools and a hand-written `LanguageModelV2` (verified by spike) |
| `ai` | 5.0.223 | **pinned to the v5 line** — `@orpc-agent/ai-sdk@1` peers on `ai@^5` (ADR-0003) |
| `@assistant-ui/react` | 0.15.1 | experience layer, used headless via `useExternalStoreRuntime` |
| `next` / `react` | 16.2.12 / 19.2.8 | current stable App Router + React 19 |
| `tailwindcss` | 4.3.3 | CSS-first tokens via `@theme inline` |
| `zod` | 4.4.3 | required by orpc-agent's JSON-Schema converter (v3 throws) |
| `vitest` / `@playwright/test` / `@axe-core/playwright` | 4.1.10 / 1.62.0 / 4.12.1 | contract tests, e2e, accessibility scans |
| `@clack/prompts` | 1.7.0 | accessible CLI prompts; flags via Node's `parseArgs` |
| `radix-ui` · `react-resizable-panels` · `lucide-react` · `next-themes` | 1.6.7 · 4.12.2 · 1.27.0 · 0.4.6 | accessible primitives, resizable panel, icons, theming |

Deliberately **not** used: `@assistant-ui/react-ai-sdk` (its current line
depends on `ai@^7`, conflicting with the `ai@^5` requirement above) and
`@mastra/ai-sdk` (unnecessary once the host maps Mastra chunks itself) —
ADR-0002.

## 4. Commands

```bash
# use the CLI
pnpm create dpas-app my-agent-app         # or npm/yarn/bun create
cd my-agent-app && pnpm dev               # http://localhost:3000

# work on this repo
pnpm install
pnpm dev                                  # runs templates/default
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:e2e                             # Playwright, production build
pnpm test:scaffold                        # generate a fresh app and run ITS gates
pnpm check:example                        # drift gate
```

## 5. The golden scenario

> “Show me the offline devices in Milan, select the visible devices, and
> disable them.”

1. The browser snapshots the live Agent Surface into wire descriptors and
   POSTs step 0 with the model-message history.
2. The server composes the turn's catalog: governed domain tools for the
   authenticated actor (`domain:devices.list`, `.get`) plus the declared
   frontend tools, and rejects any duplicate model-visible path.
3. Mastra calls `view:devices.filters.set {status: offline, city: Milan}`.
   The run ends at the client tool-call; the browser executes it through
   Agent Surface; React state updates and the table refetches.
4. `view:devices.table.readState` returns the three visible rows.
5. `view:devices.table.selectRows` sets the selection — which flips
   `domain:devices.disable` from *unavailable* ("Select at least one device
   first") to available.
6. Mastra calls `domain:devices.disable {}` — `deviceIds` is bound and locked,
   so there is nothing for the model to supply.
7. Agent Surface evaluates the binding against the live selection and mints a
   confirmation for that exact effective input.
8. assistant-ui renders the approval card: 3 devices by name and id, the
   effect, reversibility, the acting identity, single-use, and a live expiry
   countdown.
9. On approval the evidence — single-use and input-bound — is consumed; the
   call rides the app's authenticated oRPC client with correlation headers.
10. The server re-derives identity, re-authorizes (operator only), validates,
    executes, and writes the authoritative audit record.
11. `invocation-settled(ok)` invalidates the devices query; the table
    reconciles from fresh server data.
12. The assistant reports the **verified** outcome after re-reading table
    state; the full correlated trace is visible in the Agent Inspector.

Deny instead, and nothing is mutated — reported honestly. Change the
selection after approving, and execution fails with
`CONFIRMATION_INVALID { reason: "mismatch" }`.

## 6. Test and build results

| Gate | Result |
|---|---|
| `pnpm lint` | clean (both packages) |
| `pnpm typecheck` | clean, strict TS, no escape hatches on core contracts |
| `pnpm test` | **86 passed** — 75 template (capabilities, demo, host, domain, protocol, model credentials, text sanitizing) + 11 CLI |
| `pnpm build` | Next.js production build ✓, CLI build + template sync ✓ |
| `pnpm test:e2e` | **20 passed** — desktop (19) + mobile (1), incl. 4 axe scans |
| `pnpm check:example` | 107 files match generator output |
| `pnpm test:scaffold` | fresh app: install → lint → typecheck → 46 tests → build → 16 e2e, all green |
| Bundle boundary | no `AUTH_SECRET`, `createHmac`, `@mastra`, `toAISDKTools`, `node:fs` in client chunks |

Coverage highlights: view discovery/invocation/StrictMode/lifecycle/staleness,
hidden-vs-unavailable, contextual binding + locked fields, confirmation
approve/deny/expiry/mismatch, authorization denial, catalog collision,
protocol version mismatch, NDJSON framing across chunk boundaries, browser↔
server dispatch, state reconciliation, correlation propagation, runtime model
credentials (production guard, masking, never echoed), and the deterministic
golden scenario — none requiring an LLM.

## 7. Screenshots

Captured from a production build: desktop light and dark, the confirmation
card, post-approval reconciliation, Inspector timeline and catalog, mobile
dashboard and assistant sheet, and the architecture page.

## 8. ADRs and spec clarifications

Seven records in [docs/adr/](adr/). The two that changed the shape of the
implementation:

- **ADR-0002 — application-owned host protocol.** The agent-surface guide
  sketches `useChatRuntime` + `frontendTools`, but that adapter line now
  requires `ai@^7` while `@orpc-agent/ai-sdk@1` requires `ai@^5`. Rather than
  run two `ai` majors on an unverified wire contract, the Agent Host
  implements DPAS host protocol v1 — which the spec explicitly permits
  (§11.1) and the build directive independently requires (`protocol.ts`,
  `correlation.ts`, typed transport errors).
- **ADR-0005 — confirmation mode.** docs/16 warns that `wait` in a remote
  topology holds a stream open across a human decision. Under the step-loop
  protocol, frontend tools execute *between* HTTP requests, so `wait` is safe
  and gives the simplest UX; the registry still enforces single-use,
  input-bound, expiring evidence.

Also recorded: published-package strategy (0001), the `ai@5` pin (0003), the
zero-config JSON store (0004), the scripted model for credential-free CI
(0006), the server-signed demo identity (0007), runtime model credentials
connected from the UI but held only in server memory (0008), and the host
answering server tool calls Mastra leaves open (0009).

### What a live model found that the tests did not

Three defects surfaced only once a real OpenRouter key drove the app, and
each is now pinned by a test:

1. **Gateway model ids.** Mastra strips the leading provider segment, so a
   bare `anthropic/claude-sonnet-4.5` reached OpenRouter as
   `claude-sonnet-4.5` and every run failed with "No endpoints found that
   support tool use". Ids are normalized to the `openrouter/…` gateway form.
2. **Orphaned server tool calls (ADR-0009).** A model that calls a server
   tool and a client tool in one message made Mastra execute the server tool
   and then discard its result. The card hung on "running" and the history
   carried an unanswered tool-call, which providers reject.
3. **Rich text.** Answers are markdown and reasoning is a separate stream;
   both were being shown as raw text, including leaked `<|channel|>` markers.

The common cause of all three going unnoticed: the scripted CI model was
*too well behaved* — it never batched tool calls, never emitted reasoning,
never used markdown. It now does all three, so these paths run on every CI
execution.

## 9. Known limitations

- **Demo identity, not authentication.** A signed cookie with a default
  secret; `src/server/auth/session.ts` is the documented replacement seam.
- **Single-process store.** The embedded JSON store fits one server process;
  swap it behind the oRPC procedures for anything real.
- **Server approvals are off.** oRPC Agent's durable approval flow is wired
  but unused — frontend confirmation plus server authorization is the demo's
  floor. The seam is `createAgentRuntime({ approvals })`.
- **No conversation persistence.** History lives in the browser for the
  session; DPAS §11.3 storage is left to the adopting app.
- **`@agent-surface/*` is 0.x.** Minor bumps may break; the caret range is
  correctly conservative, and the scaffold smoke test is the early-warning
  system.
- **One template.** `--example` exists and is validated, but `default` is the
  only template — deliberately one excellent golden path for v0.1.
- **axe is not a proof.** Automated scans pass on the primary screens and
  dialogs; they do not replace manual assistive-technology testing.

## 10. Publishing `create-dpas-app`

```bash
# 1. one-time: npm account with 2FA, and an automation token in
#    the repo's NPM_TOKEN secret (release.yml uses it with provenance)

# 2. describe the change
pnpm changeset

# 3. merge to main — CI opens a "chore: version packages" PR

# 4. merge that PR — release.yml runs:
#      pnpm build      (compiles the CLI and syncs templates/default → template/)
#      pnpm release    (changeset publish, provenance enabled)
```

Manual equivalent:

```bash
pnpm install && pnpm build
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm test:scaffold
cd packages/create-dpas-app
npm publish --access public --provenance
```

The package ships `dist/` and `template/`; `prepack` rebuilds both, so the
published tarball can never contain a stale template. Verify after publishing
with `pnpm create dpas-app@latest smoke-check`.
