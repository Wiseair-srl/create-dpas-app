# Production scalability spec

> **Status:** Implemented. W0 (tenant isolation), W1 (scoped direct mode, protocol v2), W2 (cache-stable descriptors), W3 (meta mode) and W5 (build-time guards) have all shipped, on top of the upgrade to `@agent-surface/core` 0.3.0 and `@orpc-agent/*` 2.0.0 which closed §4.4 and emptied [§7](#7-external-dependencies). Both catalog projections ship together and are switchable at runtime against the same capabilities. See [§14 Revision notes](#14-revision-notes).
> **Scope:** the `create-dpas-app` template only — `src/agent/host/`, `src/server/`, CI. Paths are template-relative: the files live under `templates/default/`, mirrored byte-identically into `packages/create-dpas-app/template/default/` and `examples/generated-default/` and gated by `scripts/check-example-drift.mjs`. Library changes are tracked separately; see [§7 External dependencies](#7-external-dependencies).
> **Goal:** carry a real production application — order 300 domain capabilities and 40+ view capabilities mounted per route — without weakening the DPAS security model.

## 0. Summary

The host protocol as shipped is correct and well-factored for its stated scope: one page, a live surface, a few dozen capabilities. It stops working somewhere between 64 and 100 capabilities, and the binding constraints are almost all in application code this template owns rather than in the DPAS libraries. [ADR-0002](../adr/0002-host-protocol-over-react-ai-sdk.md) made the host protocol application code on purpose; the consequence is that this repo owns its ceiling.

Four workstreams here. **W0** is a correctness fix that should ship regardless of scale. **W1** and **W2** raise the ceiling to low hundreds. **W5** moves static checks to CI. **W3** goes further, for applications past the point where a scoped direct catalog stops fitting.

**Nothing is blocked.** Early drafts held W1's domain half, and then all of W2 and W3, behind library releases. `@agent-surface/core` 0.3.0 and `@orpc-agent/*` 2.0.0 shipped every one of those primitives, and W0, W1, W2 and W5 are now implemented. W3 remains as designed work, not as a dependency.

The load-bearing decision: **the catalog stops being a single flat list re-sent verbatim on every step**, and becomes a mode-selected, scope-bounded, cache-split projection. Everything else follows.

## 1. Where the ceiling is today

### 1.1 The hard cap

`ChatStepRequestSchema` caps `frontendTools` at 64 and `messages` at 200 (`src/agent/host/protocol.ts`). The browser applies no client-side limit — `runTurn` maps the entire toolset and posts it (`src/agent/host/transport-client.ts`). At 65 capabilities `safeParse` fails, the `isVersionIssue` branch is not taken because `protocolVersion` really is `1`, and the server answers:

```
400 PROTOCOL_DECODE_ERROR — "Malformed chat step request."
```

A correctly-formed request from a merely large application reports as malformed, with nothing identifying the cap as the cause. A long conversation hits the same failure through `messages`.

### 1.2 Cost per step, measured

Measured from the descriptors in [Host protocol](../reference/host-protocol.md): ~440 B on the wire per descriptor, ~256 model-visible characters, ≈71 tokens per tool at ~3.6 chars/token. Tool definitions are re-sent on every protocol step; the browser allows 8 steps per turn.

| Capabilities | Upload / step | Tokens / step | Tokens / turn (8 steps) | Cost / turn, tool defs only |
|---|---|---|---|---|
| 14 (template today) | 6 KB | 1.0k | 8k | $0.02 |
| 64 (the cap) | 27 KB | 4.5k | 36k | $0.11 |
| 150 | 64 KB | 10.7k | 85k | $0.26 |
| 300 | 129 KB | 21.3k | 170k | $0.51 |
| 600 | 258 KB | 42.6k | 341k | $1.02 |

Sonnet-class input pricing, **zero cache hits**. Estimated from descriptor sizes rather than a live tokenizer — treat absolute figures as order-of-magnitude; §6 states its target as a relative reduction against this baseline. See §1.4 for why the hit rate is zero rather than merely low.

### 1.3 The two planes scale asymmetrically

`view:*` self-limits by mount. A 300-capability application may only ever have 20 mounted on a given route, and the snapshot reflects exactly what is on screen. This is a genuine architectural strength and needs no fix beyond a safety limit.

`domain:*` does not self-limit. `toAISDKTools` exposes every capability with `expose.aiSdk: true` for the actor, on every step, regardless of route. This is the unbounded axis, and bounding it needs an upstream primitive that does not exist yet (§7).

### 1.4 Prompt caching is structurally defeated

Tool definitions sit at the front of the provider prompt. Providers cache on a stable prefix, so any change to the tool block invalidates the entire conversation prefix behind it.

The DPAS value proposition guarantees that change. `available` flips mid-turn as the UI changes; `describePrefix` in `@agent-surface/core` folds `[currently unavailable: <reason>]` into the description string; contextual bindings inject live text through `describe()` ("Currently bound to the 3 selected device(s)"). The feature that keeps the catalog honest is the feature that makes it uncacheable.

This is the deepest cost in the design and the largest available win.

### 1.5 Tenant isolation is broken in the audit stream

`getAuditLog()` is a process-global ring buffer (`src/server/audit/log.ts`, `MAX_ENTRIES = 500`). `handleChatStep` subscribes for the duration of a step and forwards every entry as an `inspector` frame with **no actor filter** (`src/agent/host/server-compose.ts`). `AuditEntry.actorId` exists and is unused.

With concurrent users, every user's Inspector receives every other user's audit activity. It worsens with capability count: `describePipeline` emits `capabilities.discovered` carrying the full `capabilityIds` array, so at 300 capabilities each browser receives a 300-element array naming another actor's entire authorized surface.

This is a data leak, not a performance characteristic. It appears here because it is in the same code path and gets worse as the catalog grows.

### 1.6 What is ours and what is not

| Constraint | Owner |
|---|---|
| 64-tool cap; misleading 400 | this repo — `src/agent/host/protocol.ts` |
| No client-side guard | this repo — `src/agent/host/transport-client.ts` |
| Full catalog re-sent per step | this repo — protocol design |
| Cross-tenant audit fan-out | this repo — `src/agent/host/server-compose.ts` |
| Lossy 500-entry in-memory audit | this repo — `src/server/audit/log.ts` |
| `CATALOG_COLLISION` kills the whole turn | this repo — `src/agent/host/server-compose.ts` |
| `canonicalId` silently degrades to `wireName` | this repo — `src/agent/host/catalog.ts` |
| `mode` / `scope` / `budget` unused | this repo — `src/agent/host/toolset.ts`, `transport-client.ts` |
| `toAISDKTools` `filter` unused | this repo — `src/agent/host/server-compose.ts` |
| v1 cannot express mode or scope | this repo — `src/agent/host/protocol.ts` |
| Availability baked into `description` | `@agent-surface/core` → [RFC 19](#7-external-dependencies) |
| `meta` mode still Experimental | `@agent-surface/core` → RFC 19 |
| 64-char wire-name overflow | `@agent-surface/core` → RFC 19 |
| `describe()` cannot filter pre-policy | `@orpc-agent/core` → plan 1.1 |
| Discovery audit payload unbounded | `@orpc-agent/core` → plan 1.1 |

Ten of fifteen are ours, which is the good outcome: most of the ceiling lifts without waiting on a library release. Note the two rows that look like one problem and are not — `describe()` cannot narrow *what it evaluates*, but `toAISDKTools` can already narrow *what the model sees*. Only the first needs a library release, and only §11's criterion 3 depends on it.

## 2. Invariants

Any change here must preserve all of the following. These are the properties that make DPAS worth using; a scalability change that trades one away is rejected.

1. **Visibility is not authority.** A frontend tool declaration grants the model the right to *see* a capability. The executor never leaves the browser and the server never gains a path to run one.
2. **Per-actor, per-step composition.** The domain half is derived from the authenticated session on every step and never cached across users.
3. **Authority hides, state discloses.** Lacking permission removes a capability entirely; wrong application state shows it with `available: false` and a reason.
4. **Confirmations wait between requests.** No server stream is held open across a human decision ([ADR-0005](../adr/0005-confirmation-wait-between-steps.md)).
5. **The server holds no run state.** The messages are the state.
6. **One operation, one model-visible path.**
7. **No silent truncation.** Any reduction is visible to the host, the Inspector, and — in meta mode — the model.
8. **Canonical id is the audit identity.** It never silently becomes something else.

## 3. W0 — Tenant isolation in the audit stream

**Ships first, independent of everything else.** Correctness, not scale. **Shipped** — all four items, plus a fifth the original list missed (item 5).

1. **Filter the subscription by actor.** `handleChatStep` forwards an entry only when `entry.actorId === session.userId`, or when the entry is host-sourced and carries the current `stepId`. Entries with no `actorId` are dropped rather than broadcast. This requires a `stepId` field on `AuditEntry`, which does not exist today — the type carries only `correlationId`. Note the deliberate cost: `auditSink` sets `actorId` conditionally, so genuinely actor-less runtime events stop reaching the Inspector. That is the right trade for a leak, and it is why host-sourced entries get their own clause rather than being dropped with them.
2. **Truncate the discovery payload locally.** The template's `auditSink` (`src/server/agent/runtime.ts`) caps `data.capabilityIds` to a count plus a digest before recording. This is a local mitigation; the upstream fix is in plan 1.1 (§7).
3. **Make the audit sink pluggable and durable.** `MAX_ENTRIES = 500` in memory is fine for the scaffold's demo, not for a governed production application. Two distinct records, and they do not share a shape:
   - **Application audit** — this template's `AuditEntry` (`source: domain | orpc-agent | host`). Its backend becomes an interface: the ring buffer stays the zero-config default (ADR-0004), with a Postgres implementation over the same driver-free `PgQuery` seam.
   - **Governance audit** — `@orpc-agent/core`'s `AgentAuditEvent`. `createPgAuditSink` from `@orpc-agent/postgres` consumes exactly this and is registered in `runtime.ts` alongside the existing sink, writing the canonical ADR-013 table with its published DDL. It is *not* a drop-in for the application log: domain and host entries never pass through the runtime.

   `@orpc-agent/postgres` depends only on `@orpc-agent/core` and takes `(sql, params) => rows`, so durability is opt-in configuration rather than a `pg` dependency forced on every scaffold.
4. **Bound the per-subscriber queue.** A slow browser reader must not apply backpressure to the audit path or grow unboundedly; drop with a counted `inspector.dropped` marker.

5. **Scope the audit READ route too.** `GET /api/agent/audit` resolved a session and then returned the entire process-wide log. The guided demo has no server stream, so the browser polls this route — meaning the leak was reachable without a live turn at all. It now reads `entries({ actorId })`.

**Acceptance.** Two concurrent sessions with different actors, driving turns simultaneously, produce zero inspector frames in session A whose `actorId` is B's. Asserted in an integration test, not by inspection. — **Met**, in `src/server/audit/log.test.ts`, together with host-entry step scoping, unattributable-entry exclusion, bounded-queue drop counting, and delivery of queued entries on close.

## 4. W1 — Scoped direct mode (protocol v2)

Keeps one tool per capability, but bounds which capabilities are in play and fails honestly when they exceed the limit.

### 4.1 Scope on both planes

The request carries a `scope`, derived from the current route by the browser:

- **View plane:** passed to `createAgentToolset({ scope })` as component-type prefixes. **Unblocked today.**
- **Domain plane:** applied as a `filter` over the described capabilities' tags. **Unblocked today** for the cost and ceiling win; see below for the part that is not.

Scope is discovery-shaping, never an authority boundary. `invoke` does not consult it on either plane. The server treats a browser-supplied scope as a request, intersects it with a server-side floor, and never widens. `@agent-surface/core` states the same rule for its own `scope` — a floor that a model-supplied scope may narrow but never widen, with `invoke` ignoring it in both modes.

**The view-plane seam is the toolset, not the snapshot.** Passing `scope` to `registry.snapshot()` alone does not work here, because the tool *list* comes from `toolset.tools()` (`catalog.ts`) while the snapshot only supplies a metadata index. Scoping the snapshot alone would leave the catalog at full size — no cost win — and every now-unindexed tool would fall through `catalog.ts`'s defaults to `effect: "unknown"`, `confirmation: "never"`, `available: true`. That is not an enforcement bypass: the confirmation gate lives inside `tool.execute()` in `@agent-surface/core` and the server never reads the wire `confirmation` field. It is a mislabelling of destructive capabilities to both the model and the Inspector, and a silent one — invariant 7. `createAgentToolset({ scope })` is the correct injection point: its `buildDirectTools()` already snapshots with `options.scope`, so one parameter narrows list and metadata coherently.

**Consequence for the host toolset.** `getHostToolset()` memoizes into a module global and `scope` is fixed at construction. Per-route scope therefore requires keying that cache by scope or dropping the singleton and building per turn. Building per turn is the simpler correct default — `buildDirectTools` already takes a fresh snapshot on every call, so the singleton saves little.

**What the domain plane can do today.** `toAISDKTools` already accepts `filter?: (descriptor) => boolean`, documented as conversation-shaping and explicitly not authorization (SI-2) — the same rule this section states. `describePipeline` already returns `tags` on every descriptor. So the whole token and ceiling win on the unbounded axis (§1.3) needs no library release:

```ts
toAISDKTools(runtime, {
  actor, context, toolNaming: domainToolName,
  filter: (d) => d.tags.some((t) => scope.includes(t)),
});
```

**What stays blocked is narrower than a scoped `describe()`.** `filter` applies *after* `describe()` returns, so discovery policies still evaluate for every capability and `capabilities.discovered` still emits every id. That is acceptance criterion 3 (policy-invocation count) and W0.2 — genuine plan 1.1 N1/N2 work. The cost and ceiling win is not waiting on it.

### 4.2 Explicit limits, honest failures

Replace the bare `.max(64)` with a named limit object and typed errors:

| Limit | Value | Enforced |
|---|---|---|
| `maxFrontendTools` | 128 | browser (pre-flight) and server |
| `maxDomainTools` | 128 | server |
| `maxTotalTools` | 192 | server |
| `maxMessages` | 400 | browser and server |

The browser checks before posting. Exceeding a limit produces `CATALOG_TOO_LARGE` (413) naming plane, count and limit — never `PROTOCOL_DECODE_ERROR`. If the host reduces a catalog to fit, it emits `catalog.truncated` carrying what was dropped and why (invariant 7).

### 4.3 `CATALOG_COLLISION` stops killing the turn

Detection stays. The response changes from 409-and-abort to: drop the duplicate frontend declaration, keep the governed server tool, record `catalog.collision` in the audit log, warn in the Inspector, run the step.

A double-exposure across a 300-capability codebase is a matter of when, and today its blast radius is the entire assistant rather than the one capability. Build-time detection moves to CI (§6).

### 4.4 Fix the canonical-id fallback

`catalog.ts` does `canonicalIdFromWireName(tool.name) ?? tool.name`. When `decodeWireName` fails on a truncated name, the audit identity silently becomes the wire name — a direct violation of invariant 8. Replace with a hard failure: drop the tool from the catalog and emit `catalog.undecodable` naming it. **A capability that cannot be audited is not offered to the model.**

## 5. W2 — Cache-stable descriptors

The largest cost win, and it does not require giving up live state disclosure. **Blocked on RFC 19 C1** (§7).

**Split the descriptor.**

- *Stable* — `wireName`, `canonicalId`, `plane`, `description`, `inputSchema`, `effect`, `confirmation`. Goes in the provider tool block. Changes only when code changes or the mount set changes.
- *Volatile* — `available`, `unavailableReason`, and any live text from a contextual binding's `describe()`. Never in the tool block. Rendered into a single compact system message appended *after* the conversation, where it costs a few hundred tokens and invalidates nothing behind it.

```
Capability state (this step):
- domain_devices__disable — unavailable: Select at least one device first
- view_devices__table__selectRows — available; 24 rows currently visible
```

**Rule:** `description` contains no live state. Currently violated upstream — `describePrefix` folds `[currently unavailable: …]` into the description string, which is why this workstream cannot start from the template alone.

**Expected effect.** The tool block becomes stable across steps 2..n of a turn whenever the mount set does not change, which is the common case. At 300 capabilities that converts ~21k tokens per step from full-rate input to cache reads for every step after the first — on the order of a 70–80% reduction in per-turn tool-definition cost, plus the TTFT improvement from a cached prefix. The volatile block adds back roughly 200–600 tokens per step.

**Anti-goal.** Do not stabilize by making descriptions stale. If a description would change for a non-state reason — a deploy, a different mount set — the cache *should* miss.

## 6. W5 — Build-time guards

Runtime detection of static problems is the wrong phase for an application this size.

These live in `src/agent/host/catalog-guards.test.tsx` and run in the normal suite, so
they need no separate CI job. What matters is that they read the **shipped
configuration** — the real capability registry and a mounted surface — not fixtures.
A guard written against fixtures passes forever and protects nothing; the pre-existing
"accepts the shipped configuration (no collisions)" test did exactly that, and has been
renamed to say what it actually covers.

1. ✅ **Collision check.** No capability is simultaneously `expose.aiSdk: true` and
   declared by the surface — the check §4.3 demotes from a turn-killing 409, hoisted to
   build time. Currently proves `domain:devices.disable` (contextual) stays disjoint
   from `domain:devices.list` / `.get` (direct).
2. ✅ **Wire-name lint.** No encoded name exceeds 64 characters, and no two collide.
   Mostly belt-and-braces now that D30 shortens and collision-checks upstream, but it
   fails in *this* repo's terms rather than as a library throw mid-turn.
3. ⬜ **Catalog budget lint.** Needs the route→scope map, so it waits on §13.1 — the one
   genuinely blocked item, and blocked on a decision rather than code.
4. ✅ **Cost snapshot.** Committed as an inline snapshot (`9` capabilities, `772` chars),
   not a ceiling. A threshold with headroom absorbs the doubling it exists to catch; a
   snapshot puts every change in the diff.

## 7. External dependencies

Two companion documents carry the library work. Neither is required for W0 or W5.

**All of it shipped.** `@agent-surface/core` 0.3.0 and `@orpc-agent/*` 2.0.0 landed
every dependency this spec was written against. Nothing here waits on a library
release any more.

| Need | Shipped as | Unblocked |
|---|---|---|
| `AgentTool.state` split from `description` | agent-surface D28 — `state` + `descriptionIncludesState` | **W2** |
| Graduate `mode: "meta"` | agent-surface D29 — supported; `surface_act` takes `surfaceVersion` | **W3** |
| 64-char-safe wire names | agent-surface D30 — collision-checked, `toolset.wireNameMap()` | §4.4, **done** |
| `scope` on `describe()`, pre-policy | orpc-agent — `scope: { tags, ids }` | criterion 3.1 |
| `scope` through `toAISDKTools` | orpc-agent — forwarded verbatim to `describe` | W1 domain half |
| Bounded `capabilities.discovered` | orpc-agent — `{ count, surface, digest }` | W0.2, **done** |

Two corrections this forced on earlier drafts:

- **N4 was not redundant.** An earlier revision argued `filter` subsumed a `scope`
  parameter and dropped it. The shipped split is better and the spec follows it:
  **`scope` decides what gets discovered; `filter` decides what survives discovery.**
  Scope avoids the policy evaluations, schema conversions and clones for everything
  the caller was about to throw away; `filter` still shapes the remainder. Neither is
  authorization.
- **D30 makes §4.4 urgent rather than optional.** `decodeWireName` now refuses any
  name it cannot re-encode byte-identically, so the old `?? wireName` fallback turns
  a shortened name straight into a corrupted audit identity. The template no longer
  reverses names at all — see §9.

**W3 — meta mode**, deferred. `@agent-surface/core` already implements `createAgentToolset(registry, { mode: "meta" })`, yielding `surface_discover` / `surface_read` / `surface_act` instead of N tools. The tool block becomes constant-size, W2's cache stability becomes near-total, and §4.2's limits stop binding. It also addresses the accuracy problem that is independent of tokens: flat lists of hundreds of tools degrade model selection regardless of context window. Protocol v2 carries `catalog.mode` so a deployment can opt in per environment. Treat as designed-but-not-shipped until RFC 19 C2 lands.

## 8. Protocol v2 wire format

```ts
export const PROTOCOL_VERSION = 2 as const;

export const CATALOG_LIMITS = {
  maxFrontendTools: 128,
  maxDomainTools: 128,
  maxTotalTools: 192,
  maxMessages: 400,
} as const;

/** Stable half — goes in the provider tool block. Contains no live state. */
export const WireToolDescriptorSchema = z.object({
  wireName: z.string().min(1).max(64),
  canonicalId: z.string().min(1).max(128),
  plane: z.enum(["view", "domain"]),
  description: z.string().max(1000),
  inputSchema: z.record(z.string(), z.unknown()),
  effect: z.string().max(64),
  confirmation: z.enum(["never", "optional", "required"]),
});

/** Volatile half — rendered as a trailing system message, never in the tool block. */
export const WireToolStateSchema = z.object({
  wireName: z.string().min(1).max(64),
  available: z.boolean(),
  unavailableReason: z.string().max(300).optional(),
  note: z.string().max(300).optional(),
});

export const ChatStepRequestSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  conversationId: z.string().min(1).max(64),
  turnId: z.string().min(1).max(64),
  stepIndex: z.number().int().min(0).max(64),
  messages: z.array(WireModelMessageSchema).min(1).max(CATALOG_LIMITS.maxMessages),
  catalog: z.object({
    mode: z.enum(["direct", "meta"]),
    /** Discovery shaping. View: component-type prefixes. Domain: capability tags. */
    scope: z.array(z.string().max(64)).max(32).optional(),
    frontendTools: z.array(WireToolDescriptorSchema).max(CATALOG_LIMITS.maxFrontendTools),
    frontendState: z.array(WireToolStateSchema).max(CATALOG_LIMITS.maxFrontendTools),
    /** Set when the browser reduced the catalog to fit. Never silent. */
    truncated: z.object({ dropped: z.number().int(), reason: z.enum(["budget", "limit"]) }).optional(),
  }),
});
```

New frames and error codes:

| Addition | Kind | Meaning |
|---|---|---|
| `CATALOG_TOO_LARGE` | error, 413 | A named limit was exceeded; message carries plane, count, limit |
| `catalog.truncated` | inspector | The host reduced a catalog to fit; carries what was dropped |
| `catalog.collision` | inspector + audit | A duplicate path was dropped; the turn continues |
| `catalog.undecodable` | inspector + audit | A wire name did not decode; the tool was withheld from the model |

`step-start` gains `catalogMode` and the effective `scope`, so the Inspector shows what the model was actually offered.

## 9. Change list

| File | Change | WS |
|---|---|---|
| `src/agent/host/catalog.ts` | ✅ Hard-fail undecodable names; stable/volatile split projection | W1, W2 |
| `src/agent/surface/registry.ts` | ✅ `snapshotMergesContextualNote: false` — live text out of `description` | W2 |
| `src/agent/host/protocol.ts` | ✅ v1 + v2 schemas, `normalizeChatStep`, `CATALOG_LIMITS`, `CATALOG_TOO_LARGE` | W1 |
| `src/agent/host/scope.ts` | ✅ *(new)* Route→scope floor and intersection | W1 |
| `src/agent/host/toolset.ts` | ✅ Scoped, cached per registry+scope, `descriptionIncludesState: false` · ⬜ `mode` | W1, W2, W3 |
| `src/agent/host/transport-client.ts` | ✅ Pre-flight limits, scoped snapshot, v2 body with split descriptor/state | W1, W2 |
| `src/agent/host/server-compose.ts` | ✅ Actor-filtered subscription, `stepId`, drop marker, wire-name capture, version dispatch, `scope` into `toAISDKTools`, collision warn-and-drop, volatile block rendered after the messages | W0, W1, W2 |
| `src/agent/host/wire-names.ts` | ✅ Reversal removed entirely — encoding only | W0 |
| `src/app/api/agent/audit/route.ts` | ✅ Actor-scoped read — the second leak, not in the original list | W0 |
| `src/server/audit/log.ts` | ✅ `stepId`, pluggable backend, bounded per-subscriber queue, actor-scoped `entries()` | W0 |
| `src/server/audit/postgres.ts` | ✅ *(new)* Postgres backend over the `PgQuery` seam; `configureDurableAudit` | W0 |
| `src/server/agent/runtime.ts` | ✅ `createPgAuditSink` when configured, verbose off | W0 |
| `src/server/orpc/procedures.ts` | ✅ `tags: ["devices"]` on every capability — the domain half of the scope key | W1 |
| `src/agent/host/catalog-guards.test.tsx` | ✅ *(new)* Collision, wire-name, route-budget and cost guards against the shipped config | W5 |
| `docs/reference/host-protocol.md` | ✅ v2 documented alongside v1: limits, scope, map-only wire-name reversal, collision degradation | W1 |

## 10. Migration

**Protocol.** v1 and v2 are served side by side for one minor release. The server dispatches on `protocolVersion`; a v1 request takes the existing path and records a deprecation entry. `PROTOCOL_VERSION_MISMATCH` remains for anything else. A stale browser tab keeps working through a deploy rather than breaking on the next message.

**Ordering constraint.** W2 cannot ship before RFC 19 C1. Everything else in W0, W1 and W5 is unblocked today; plan 1.1 N1 gates only the pre-policy half of criterion 3, which lands after W2 rather than before W1.

## 11. Acceptance criteria

Measured against a fixture application with 300 domain capabilities across 6 tag groups and 40 view capabilities mounted on the busiest route.

1. **No false protocol errors.** No legal catalog at any size produces `PROTOCOL_DECODE_ERROR`. Exceeding a limit produces `CATALOG_TOO_LARGE` naming plane, count and limit.
2. **Tenant isolation.** Two concurrent sessions with distinct actors produce zero inspector frames carrying the other's `actorId`. Integration test, not review.
3. **Scoped catalog.** On a route scoped to one tag group, the composed catalog contains only that group's domain capabilities plus mounted view capabilities. Ships in step 3.
   1. **Scoped evaluation.** `describe` evaluates discovery policies only for that group — asserted by policy-invocation count, not timing. This is the half that waits on plan 1.1 N1 (step 5); until then policy evaluation stays proportional to the whole registry even though the catalog does not.
   2. **No metadata degradation.** Every tool in a scoped catalog carries its real `effect`, `confirmation` and `available` — no descriptor falls through to `catalog.ts`'s `"unknown"` / `"never"` / `true` defaults. Guards the §4.1 failure mode directly.
4. **Cache stability.** Across steps 2..n of a turn in which the mount set does not change, the serialized provider tool block is byte-identical to step 1. Asserted on the request, independent of any provider cache reporting. — **Met**, in `src/agent/host/cache-stability.test.tsx`, across an availability flip and a changed contextual note.
5. **Cost.** At 300 capabilities with W1+W2 active, per-turn tool-definition tokens billed at full rate drop by ≥70% against the §1.2 baseline.
6. **Honest truncation.** Every reduction emits `catalog.truncated`; no code path drops a tool silently.
7. **Collision resilience.** A deliberately double-exposed capability degrades to one dropped declaration plus an audit record; the turn completes.
8. **Invariants hold.** Existing host and capability suites pass unchanged — schema surgery on bound fields, `when()` availability, viewer hiding, confirmation-between-steps.

## 12. Rollout

| Order | Workstream | Blocked by | Risk | Status |
|---|---|---|---|---|
| 0 | Upgrade to agent-surface 0.3.0 + orpc-agent 2.0.0 | — | medium | **Done** — §4.4 closed with it |
| 1 | W0 tenant isolation | — | low | **Done** — leak closed on both read paths, durable sink wired |
| 2 | W5 build-time guards | — | low | **Done** — collision, wire-name and cost guards run against the shipped config |
| 3 | W1 both planes + v2 | — | medium | **Done** — scope on both planes, named limits, collision resilience |
| 4 | W2 cache-stable descriptors | — | medium | **Done** — tool block byte-identical across a state change |
| 5 | W3 meta mode | — | high | **Done** — both projections ship, switchable at runtime |

Nothing is blocked. Criterion 3.1 folded into step 3 rather than needing a step of its
own, because `describe` now takes the scope directly — asserted by driving the runtime
with an out-of-scope tag and getting an empty catalog, not by inspecting the request.

Steps 1–2 are worth doing whether or not the rest is ever scheduled.

## 13. Unresolved questions

1. ~~Scope source~~ — **resolved: both, split by who knows what.** Feature modules declare their own token (domain via `meta.tags`, view via the component `type` prefix — one token, `"devices"`, covers both because both already declare it next to the code). A route declares only which features it mounts, in `src/agent/host/scope.ts`. A central config owning the whole map would restate capability knowledge in a second place and drift from it. Empty means unscoped rather than empty, which keeps protocol v1 working and is safe because scope is not an authority boundary.
2. Volatile block placement — trailing system message, or synthetic tool result? System message is simpler; tool result survives some providers' reordering.
3. `maxTotalTools: 192` — right ceiling, or per-provider?
4. Meta mode: opt-in per deployment, or automatic fallback when a scoped direct catalog exceeds the limit?
5. Host toolset memo — key `getHostToolset()` by scope, or drop the singleton and build per turn? Per turn is the recommendation; `buildDirectTools` re-snapshots on every call regardless.
6. Fixture app in this repo as a bench target, or in `examples/`?

**Resolved.** *Durable audit sink* — in W0 scope, opt-in: the ring buffer stays the zero-config default, Postgres activates on configuration, and no `pg` dependency is added to the template (§3.3).

## 14. Revision notes

Every claim in §1 was checked against the source before this revision. §1.1–§1.6 held as written: the `.max(64)` cap, the missing client-side guard, the `?? tool.name` fallback, the 409-and-abort collision path, and the unfiltered audit subscription are all present as described. Upstream, `describePrefix` does fold `[currently unavailable: …]` into the description string, `mode: "meta"` is implemented and flagged Experimental, and `describe()` does take only `(surface, { actor, context })`. §1.4's caching argument stands.

Three things changed.

1. **The view-plane scope seam moved** from `registry.snapshot()` to `createAgentToolset()`. The original would not have reduced the catalog and would have silently degraded metadata on every out-of-scope tool. §4.1 carries the reasoning; §11's criterion 3.2 now tests for it.
2. **The domain half of W1 was unblocked.** `toAISDKTools`'s existing `filter`, plus the `tags` already on every descriptor, deliver the cost and ceiling win with no library release. Plan 1.1 N1 was re-scoped to criterion 3.1 and N4 dropped as redundant. §12 collapses the old step 4 into step 3.
3. **W0.1 gained a prerequisite.** Its filter predicate referenced `stepId`, which `AuditEntry` does not have. §3 now names the field and states the deliberate cost of dropping actor-less entries.

Two smaller fixes: §1.6 miscounted its own table (eight of thirteen → ten of fifteen, after splitting the `filter` row out of the unused-options row), and §1.6 previously listed `filter` as unused while §4.1 and §7 treated the same capability as missing upstream. §1.2's cost table is unchanged and still estimated rather than tokenized — W5.4's cost snapshot should become its source of truth once it exists.

### Second revision — after the 0.3.0 / 2.0.0 releases

`@agent-surface/core` 0.3.0 and `@orpc-agent/*` 2.0.0 shipped every dependency in §7, so the blocked list is empty and the rollout in §12 collapses accordingly. Three things this changed beyond the obvious:

1. **N4 was reinstated.** The first revision argued `filter` subsumed a `scope` parameter. It does not: `scope` narrows *before* the discovery policies run, `filter` after. The released split is the better design and §7 now records it as such.
2. **§4.4 stopped being optional.** D30's `decodeWireName` refuses anything it cannot re-encode byte-identically. The template's `split("_at_")` reversal plus `?? wireName` fallback therefore turned a shortened name directly into a corrupted audit identity — invisible at 14 capabilities, certain at 300. Reversal is gone; the browser reads `toolset.wireNameMap()` and the server captures names as it assigns them. A capability that cannot be mapped is withheld from the model and reported.
3. **W0.2 was deleted rather than built.** `capabilities.discovered` is constant-size upstream now, so the local truncation this spec called for would have been code written to be immediately redundant.

### Third revision — after W1

Scope now lands on both planes, protocol v2 is served alongside v1, and §13.1 is
resolved (see §13). Four things worth recording:

1. **The toolset cache had to be keyed by registry, not just scope.** A toolset holds a
   reference to the registry it was built against, so a scope-only cache hands back a
   toolset pointing at a disposed registry the moment the registry is replaced — which
   happens between tests and on hot reload. It is a `WeakMap<registry, Map<scope, …>>`.
2. **Empty scope means unscoped, not empty.** The first draft of `scope.ts` claimed the
   opposite in a comment while the code did the former. Unscoped is the right default:
   scope is not an authority boundary, so an unlisted route gets a catalog that costs
   more, never one that exposes more — and protocol v1, which carries no route at all,
   keeps working through the migration.
3. **An empty intersection falls back to the route floor.** A browser asking for a token
   the route does not have is a stale tab or a bug; blanking the catalog would turn that
   into a silently useless assistant. Narrowing to nothing is not something a caller
   needs.
4. **`x-dpas-protocol-version` echoes the version actually used**, not the newest the
   server knows, or a v1 client would be told it spoke v2.

### Fourth revision — after W2

The description/state split is in: the registry is built with
`snapshotMergesContextualNote: false` and the toolset with
`descriptionIncludesState: false`, the wire descriptor carries only the stable
half, and the volatile half is rendered as a trailing system message after the
conversation. Three notes:

1. **Criterion 4 is asserted directly.** `cache-stability.test.tsx` selects rows —
   flipping `domain:devices.disable` from unavailable to available and changing the
   contextual note — then asserts the serialized tool block is byte-identical across
   the two projections while the state half differs. That is the property, tested on
   the request rather than inferred from any provider's cache reporting.
2. **The cost guard moved on its own**, 772 → 727 characters, which is the contextual
   note leaving the tool block. Small at 9 capabilities; it is the same mechanism that
   converts ~21k tokens per step into cache reads at 300.
3. **The Inspector re-merges the note deliberately.** It is human-facing and never
   cached, so `snapshotToCatalogRows` appends `contextualNote` back onto the
   description. Keeping the halves apart matters for the model's prompt prefix, not
   for a person reading the catalog.

### Fifth revision — after W3

Both projections ship in one application, over one registry, switchable from the
assistant header. Two examples were considered and rejected: the whole point is that
the capabilities are identical, and a second example would duplicate the feature module
and drift — which is why this repo already carries a drift gate.

What the spec had wrong or unsaid:

1. **"Constant-size tool block" overstates it.** Meta mode collapses the *surface* half
   to three tools. The domain half comes from `toAISDKTools`, which has no meta mode, so
   a wide domain surface is still bounded by scope (W1) rather than by meta. The two
   compose — scoped domain + meta view — and neither substitutes for the other.
2. **`wireNameMap()` is empty in meta mode**, because the three tool names are not
   capability ids. §4.4's withholding rule would therefore have stripped the entire
   catalog. The mode is now passed into the projection rather than inferred from the
   empty map: that same emptiness also describes a direct catalog in which nothing
   mapped, and the two cases need opposite handling.
3. **The audit identity moves into the arguments.** In direct mode the wire name is the
   capability; in meta mode the model calls `surface_act` and names its target in
   `capabilityId`. Recording the tool name would collapse every action in the
   application into one audit identity, so `canonicalIdOfCall` reads the target from the
   call and the resolved id is remembered per tool-call id — the result frame has no
   input to re-derive it from, and both frames must name the same operation.
4. **The guided demo is pinned to direct.** It is a scripted local walkthrough that
   names capabilities itself and never involves a model, so it resolves tools by encoded
   capability name; none of the three meta names would match. The toggle governs what a
   model is offered, which the demo has nothing to say about.

Verified in the running app against the scripted model: the same turn posts
`mode: "direct"` with 9 tools, or `mode: "meta"` with exactly
`surface_discover` / `surface_read` / `surface_act`.

Two findings from implementation that the spec had not anticipated:

- **The audit stream was not the only leak.** `GET /api/agent/audit` resolved a session and then returned the whole process-wide log. §3 named only `handleChatStep`; both read paths are now actor-scoped.
- **`meta.adapters.aiSdk.toolName` bypasses `toolNaming`.** The adapter honours a per-capability override ahead of the host's naming function, so capturing names during assignment can miss one. The server checks for that and withholds anything unmapped rather than guessing.
